"""Generate a 100% Certified Organic Agriculture & Soil Microbiome PDF manual using pure Python stdlib."""
import os

PAGES = [
    [
        "ORGANIC EGYPTIAN AGRICULTURE & BIO-FERTILITY MANUAL (2026 CERTIFIED EDITION)",
        "Strict Policy: 100% Organic Inputs Only - Zero Synthetic Fertilizers or Chemical Pesticides",
        "1. Thermal Aerobic Compost & Vermicompost Standards (per Feddan = 4200 m2):",
        "- Mature Plant-Animal Compost: 15 to 25 m3/feddan; C:N ratio 15:1 to 20:1; thermophilic phase 55-65C for 15 days",
        "  to eliminate weed seeds, root-knot nematodes, and E. coli/Salmonella pathogens.",
        "- Vermicompost (Earthworm Castings): 1.5 to 3.0 tonnes/feddan banded in planting rows; supplies humic/fulvic acids,",
        "  plant-available organic N, beneficial actinomycetes, and natural root growth enzymes.",
        "- Aerated Compost Tea (ACT): Brew 10 kg vermicompost + 1.5 L sugarcane molasses + 250 g kelp extract in 200 L",
        "  dechlorinated water with continuous air-pump oxygenation for 24-36 hours; inject 40-60 L/feddan via drip.",
    ],
    [
        "2. Natural Mineral & Bio-Fertilizer Replacements (Zero Chemical NPK):",
        "- Organic Nitrogen: Legume green manures (Egyptian Berseem clover incorporate 35-45 kg organic N/feddan),",
        "  Rhizobium inoculant (Okadin) on legumes, free-living Azotobacter chroococcum & Azospirillum brasilense (2 L/feddan),",
        "  and enzymatic plant amino acids or hydrolyzed fish emulsion.",
        "- Organic Phosphorus: Natural ground Rock Phosphate (300-400 kg/feddan, 26-30% P2O5 natural mineral) activated with",
        "  Bacillus megaterium (Phosphorine bio-inoculant, 2 L/feddan) + Mycorrhizal fungi + 100 kg micronized elemental sulfur.",
        "- Organic Potassium: Natural ground Potassium Feldspar (250-500 kg/feddan) solubilized by Bacillus mucilaginosus",
        "  + Ascophyllum nodosum marine kelp extract sprays during flowering, fruit set, and tuber/bulb bulking.",
        "3. Biological Pest & Disease Control & Organic Certification (Egypt Law 12/2020 & EU Organic):",
        "- Lepidoptera (Fall Armyworm, Tuta absoluta): Trichogramma cards (25-30/feddan) + Bacillus thuringiensis (Bt)",
        "  300-400 g/feddan + Cold-pressed Neem Oil (Azadirachtin) 500 mL/200 L water sprayed at dusk + Pheromone water traps.",
        "- Fungal Blights & Root Rots: Trichoderma harzianum + Bacillus subtilis + Potassium Bicarbonate / Micronized Sulfur.",
        "- Conversion Period: 24 months for annual field/vegetable crops and 36 months for perennial orchards.",
    ],
]


def escape_pdf_text(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pdf(output_path: str) -> None:
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    objects: list[bytes] = []
    page_obj_ids = []
    content_obj_ids = []
    next_id = 4
    for _ in PAGES:
        page_obj_ids.append(next_id)
        content_obj_ids.append(next_id + 1)
        next_id += 2

    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{pid} 0 R" for pid in page_obj_ids)
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(PAGES)} >>".encode("ascii"))
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    for lines, pid, cid in zip(PAGES, page_obj_ids, content_obj_ids):
        stream_cmds = ["BT", "/F1 10 Tf", "42 745 Td", "15 TL"]
        for i, line in enumerate(lines):
            escaped = escape_pdf_text(line)
            if i == 0:
                stream_cmds.append(f"({escaped}) Tj")
            else:
                stream_cmds.append(f"T* ({escaped}) Tj")
        stream_cmds.append("ET")
        stream_bytes = "\n".join(stream_cmds).encode("ascii")

        page_dict = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {cid} 0 R >>"
        ).encode("ascii")
        content_dict = f"<< /Length {len(stream_bytes)} >>\nstream\n".encode("ascii") + stream_bytes + b"\nendstream"
        objects.append(page_dict)
        objects.append(content_dict)

    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out.extend(f"{idx} 0 obj\n".encode("ascii"))
        out.extend(obj)
        out.extend(b"\nendobj\n")

    xref_pos = len(out)
    out.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    out.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.extend(f"{off:010d} 00000 n \n".encode("ascii"))
    out.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("ascii")
    )
    with open(output_path, "wb") as f:
        f.write(out)


if __name__ == "__main__":
    build_pdf("/app/applet/data/organic_certification_manual_2026.pdf")
    print("Generated /app/applet/data/organic_certification_manual_2026.pdf")
