"""Build the browser symbol subset from STIX Two Math 2.13b171."""

import argparse

from fontTools import subset
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source")
parser.add_argument("output")
args = parser.parse_args()

font = TTFont(args.source, recalcTimestamp=False)
options = subset.Options()
options.layout_features = ["*"]
options.name_IDs = ["*"]
options.name_legacy = True
options.name_languages = ["*"]
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=[0x20E5, 0x2201, 0x2ACB, 0x2ACC, 0x2AFD])
subsetter.subset(font)

# The double-underlined relations fit beside capitals without a deep descender.
for codepoint in (0x2ACB, 0x2ACC):
    name = font.getBestCmap()[codepoint]
    pen = TTGlyphPen(None)
    font.getGlyphSet()[name].draw(TransformPen(pen, (0.7, 0, 0, 0.7, 0, 150)))
    font["glyf"][name] = pen.glyph()
    width, bearing = font["hmtx"][name]
    font["hmtx"][name] = (round(width * 0.7), round(bearing * 0.7))

names = {
    1: "DSH Math Symbols",
    2: "Regular",
    3: "DSH Math Symbols Regular 1.0",
    4: "DSH Math Symbols Regular",
    6: "DSHMathSymbols-Regular",
    16: "DSH Math Symbols",
    17: "Regular",
    21: "DSH Math Symbols",
    22: "Regular",
}
for record in font["name"].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
font.flavor = "woff2"
font.save(args.output)
