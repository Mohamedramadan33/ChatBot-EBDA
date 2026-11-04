"""External Agricultural Data Connectors: Ag-Weather APIs & Public Soil/Commodity Databases.

Architecture Pattern:
1. High-Volatility Ephemeral Data (Hourly/7-Day Ag-Weather, Evapotranspiration ET0, Soil Moisture):
   Fetched via Open-Meteo (zero-key) or OpenWeatherMap API, normalized into agronomic summary passages,
   and upserted into ChromaDB with deterministic location IDs + TTL metadata so outdated forecasts are
   cleanly overwritten rather than polluting vector space.
2. Semi-Static Public Agricultural Databases (ISRIC SoilGrids 250m soil properties, USDA NASS QuickStats,
   FAOSTAT regional yield & price benchmarks):
   Pulled on scheduled ETL intervals (daily/weekly), converted into unit-explicit prose records, and
   indexed alongside local PDF/CSV/JSON manuals.
"""
from typing import Any
import httpx

from .config import settings
from .rag_pipeline import AgronomyRAGPipeline


async def sync_open_meteo_ag_weather(
    rag: AgronomyRAGPipeline,
    latitude: float,
    longitude: float,
    region_label: str = "Farm Field Station",
) -> dict[str, Any]:
    """Fetch 7-day agronomic weather, FAO ET0 evapotranspiration, and root-zone soil moisture."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "Current": "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,soil_temperature_6cm,soil_moisture_3_to_9cm",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration",
        "timezone": "auto",
        "forecast_days": 7,
    }
    # Open-Meteo uses lowercase 'current'
    params["current"] = params.pop("Current")

    async with httpx.AsyncClient(timeout=12.0) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        payload = resp.json()

    current = payload.get("current", {})
    daily = payload.get("daily", {})
    dates = daily.get("time", [])
    tmax = daily.get("temperature_2m_max", [])
    tmin = daily.get("temperature_2m_min", [])
    rain = daily.get("precipitation_sum", [])
    et0 = daily.get("et0_fao_evapotranspiration", [])

    total_rain_7d = round(sum(x or 0.0 for x in rain), 1)
    total_et0_7d = round(sum(x or 0.0 for x in et0), 1)
    net_water_balance = round(total_rain_7d - total_et0_7d, 1)

    daily_rows = [
        f"{d}: {lo}-{hi}C, Rain {r}mm, FAO-ET0 {e}mm"
        for d, hi, lo, r, e in zip(dates, tmax, tmin, rain, et0)
    ]

    passage = (
        f"Live Ag-Weather & Irrigation Telemetry for {region_label} ({latitude:.3f}, {longitude:.3f}): "
        f"Current air temp {current.get('temperature_2m')}C, RH {current.get('relative_humidity_2m')}%, "
        f"6cm soil temp {current.get('soil_temperature_6cm')}C, "
        f"3-9cm volumetric soil moisture {current.get('soil_moisture_3_to_9cm')} m3/m3. "
        f"7-Day Cumulative Precipitation: {total_rain_7d} mm vs. Cumulative Reference Evapotranspiration (ET0): {total_et0_7d} mm "
        f"(7-Day Net Atmospheric Water Balance: {net_water_balance:+.1f} mm). "
        f"Daily Breakdown: {' | '.join(daily_rows)}."
    )

    upserted = rag.upsert_dynamic_records(
        source_name="open_meteo_live_agweather",
        format_label="LIVE_API",
        records=[{"section": f"{region_label} ({latitude:.2f},{longitude:.2f})", "text": passage}],
        source_type="live_api",
    )
    return {"upserted": upserted, "summary": passage, "net_water_balance_mm": net_water_balance}


async def sync_openweather_forecast(
    rag: AgronomyRAGPipeline,
    latitude: float,
    longitude: float,
    region_label: str = "Farm Field Station",
) -> dict[str, Any]:
    """Optional OpenWeatherMap 5-day/3-hour free-tier connector when OPENWEATHER_API_KEY is configured."""
    if not settings.openweather_api_key:
        return {"upserted": 0, "skipped": "OPENWEATHER_API_KEY not set; using zero-key Open-Meteo instead."}

    url = "https://api.openweathermap.org/data/2.5/forecast"
    params = {"lat": latitude, "lon": longitude, "appid": settings.openweather_api_key, "units": "metric"}
    async with httpx.AsyncClient(timeout=12.0) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()

    entries = data.get("list", [])[:8]  # Next 24 hours (8 x 3h intervals)
    rain_24h = sum((item.get("rain") or {}).get("3h", 0.0) for item in entries)
    temps = [item["main"]["temp"] for item in entries if "main" in item]
    passage = (
        f"OpenWeatherMap 24h Spray-Window & Frost Advisory for {region_label}: "
        f"Temp range {min(temps):.1f}C to {max(temps):.1f}C, 24h forecast rainfall {rain_24h:.1f} mm."
    )
    upserted = rag.upsert_dynamic_records(
        source_name="openweathermap_live",
        format_label="LIVE_API",
        records=[{"section": region_label, "text": passage}],
        source_type="live_api",
    )
    return {"upserted": upserted, "summary": passage}


async def sync_isric_soilgrids_profile(
    rag: AgronomyRAGPipeline,
    latitude: float,
    longitude: float,
    region_label: str = "Farm Field Station",
) -> dict[str, Any]:
    """Query public ISRIC SoilGrids v2.0 REST API for 0-30cm pH, clay, sand, and organic carbon."""
    url = "https://rest.isric.org/soilgrids/v2.0/properties/query"
    params = [
        ("lon", str(longitude)),
        ("lat", str(latitude)),
        ("property", "phh2o"),
        ("property", "clay"),
        ("property", "sand"),
        ("property", "soc"),
        ("depth", "0-5cm"),
        ("depth", "5-15cm"),
        ("value", "mean"),
    ]
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()

    layers = data.get("properties", {}).get("layers", [])
    metrics: list[str] = []
    for layer in layers:
        name = layer.get("name")
        d_factor = layer.get("unit_measure", {}).get("d_factor", 1) or 1
        mapped_units = layer.get("unit_measure", {}).get("mapped_units", "")
        depths = layer.get("depths", [])
        if depths:
            raw_val = depths[0].get("values", {}).get("mean")
            if raw_val is not None:
                metrics.append(f"{name}: {round(raw_val / d_factor, 2)} {mapped_units}")

    passage = (
        f"ISRIC SoilGrids Public Soil Survey for {region_label} ({latitude:.3f}, {longitude:.3f}): "
        + (", ".join(metrics) if metrics else "No raster cell value returned; verify with local soil core.")
    )
    upserted = rag.upsert_dynamic_records(
        source_name="isric_soilgrids_public_db",
        format_label="PUBLIC_DB",
        records=[{"section": region_label, "text": passage}],
        source_type="public_db",
    )
    return {"upserted": upserted, "summary": passage}
