"""Build browser mathematical symbols from STIX Two Math."""

import argparse

from fontTools import subset
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source")
parser.add_argument("output")
args = parser.parse_args()

font = TTFont(args.source, recalcTimestamp=False)

# The upright stem and short inward terminals distinguish complement from Latin C.
name = font.getBestCmap()[0x2201]
pen = TTGlyphPen(None)
pen.moveTo((400, 535))
pen.lineTo((400, 588))
pen.qCurveTo((400, 704), (238, 704))
pen.qCurveTo((60, 704), (60, 584))
pen.lineTo((60, 112))
pen.qCurveTo((60, -8), (238, -8))
pen.qCurveTo((400, -8), (400, 112))
pen.lineTo((400, 170))
pen.lineTo((334, 170))
pen.lineTo((334, 106))
pen.qCurveTo((334, 60), (238, 60))
pen.qCurveTo((126, 60), (126, 112))
pen.lineTo((126, 584))
pen.qCurveTo((126, 636), (238, 636))
pen.qCurveTo((334, 636), (334, 586))
pen.lineTo((334, 535))
pen.closePath()
font["glyf"][name] = pen.glyph()
font["hmtx"][name] = (460, 60)

# Match the letters' height while retaining the slope and the 74-unit line weight.
name = font.getBestCmap()[0x2AFD]
pen = TTGlyphPen(None)
for offset in [0, 182]:
    pen.moveTo((398 + offset, 660))
    pen.lineTo((121 + offset, -60))
    pen.lineTo((47 + offset, -60))
    pen.lineTo((324 + offset, 660))
    pen.closePath()
font["glyf"][name] = pen.glyph()
font["hmtx"][name] = (627, 47)

# A short reverse slash crosses both lines, with equal overhang at each end.
name = font.getBestCmap()[0x20E5]
pen = TTGlyphPen(None)
pen.moveTo((-208, 113))
pen.lineTo((-265, 113))
pen.lineTo((-419, 487))
pen.lineTo((-362, 487))
pen.closePath()
font["glyf"][name] = pen.glyph()
font["hmtx"][name] = (0, -419)
font["head"].fontRevision = 1.5

def rename(family):
    names = {
        1: family, 2: "Regular", 3: f"{family} Regular 1.5",
        4: f"{family} Regular", 5: "Version 1.5", 6: family.replace(" ", "") + "-Regular",
        16: family, 17: "Regular", 21: family, 22: "Regular",
    }
    for record in font["name"].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())


options = subset.Options()
options.layout_features = ["*"]
options.name_IDs = ["*"]
options.name_legacy = True
options.name_languages = ["*"]
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=[0x20E5, 0x2201, 0x2AFD])
subsetter.subset(font)

rename("DSH Math Symbols")
font.flavor = "woff2"
font.save(args.output)
