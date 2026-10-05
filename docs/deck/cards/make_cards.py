"""Three empty rounded cards (blue, green, blue-grey) at high resolution, transparent background, for Canva."""
from PIL import Image, ImageDraw
S = 4                                    # supersample factor for smooth edges
CW, CH, GAP, R, LW, PAD = 1200, 1800, 100, 70, 7, 12   # final pixels per card
cards = [("#EEF3FC", "#6FA8E6"), ("#EAF6EE", "#5FAE74"), ("#F1F4FB", "#8FAEDF"), ("#FDF8E4", "#D9B84F")]
def card(fill, edge):
    im = Image.new("RGBA", ((CW + 2 * PAD) * S, (CH + 2 * PAD) * S), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle((PAD * S, PAD * S, (PAD + CW) * S, (PAD + CH) * S), radius=R * S, fill=fill, outline=edge, width=LW * S)
    return im.resize((CW + 2 * PAD, CH + 2 * PAD), Image.LANCZOS)
singles = [card(f, e) for f, e in cards]
for i, c in enumerate(singles, 1): c.save(f"card{i}.png")
row = Image.new("RGBA", (len(singles) * (CW + 2 * PAD) + (len(singles) - 1) * GAP, CH + 2 * PAD), (0, 0, 0, 0))
for i, c in enumerate(singles): row.alpha_composite(c, (i * (CW + 2 * PAD + GAP), 0))
row.save("cards_row.png"); print(row.size)
