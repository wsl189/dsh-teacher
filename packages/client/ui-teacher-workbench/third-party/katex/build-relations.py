"""Build compact proper-set signs centered beside uppercase set letters."""

import argparse
import math

from fontTools import subset
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("ams")
parser.add_argument("main")
parser.add_argument("output")
args = parser.parse_args()

font = TTFont(args.ams, recalcTimestamp=False)
main = TTFont(args.main, recalcTimestamp=False)


def contours(source, codepoint):
    recording = RecordingPen()
    source["glyf"][source.getBestCmap()[codepoint]].draw(recording, source["glyf"])
    result = []
    current = RecordingPen()
    for command in recording.value:
        current.value.append(command)
        if command[0] == "closePath":
            result.append(current)
            current = RecordingPen()
    return result


def flattened_curve(codepoint):
    curve = contours(font, codepoint)[0]
    # Inner and outer contours share a center; separate heights retain 40-unit rules.
    if codepoint == 0x2ACB:
        inner, upper_caps, lower_caps = range(6, 16), (4, 5), (16, 17)
    else:
        inner, upper_caps, lower_caps = range(11, 22), (0, 1, 22), (9, 10)
    result = RecordingPen()
    for index, (command, points) in enumerate(curve.value):
        if index in upper_caps:
            height = lambda y: y - 265
        elif index in lower_caps:
            height = lambda y: y - 149
        elif index in inner:
            height = lambda y: 96 + (y - 245) * 384 / 500
        else:
            height = lambda y: 56 + (y - 205) * 464 / 580
        result.value.append((command, tuple((x, round(height(y))) for x, y in points)))
    return result


# The diagonal retains a 40-unit stroke and extends just beyond both bars.
start, end = (287, -275), (479, -59)
length = math.hypot(end[0] - start[0], end[1] - start[1])
along = ((end[0] - start[0]) * 20 / length, (end[1] - start[1]) * 20 / length)
across = (-along[1], along[0])


def point(origin, tangent=0, normal=0):
    return tuple(round(origin[i] + tangent * along[i] + normal * across[i]) for i in range(2))


pen = TTGlyphPen(None)
pen.moveTo(point(start, normal=1))
pen.lineTo(point(end, normal=1))
pen.qCurveTo(point(end, 1, 1), point(end, 1))
pen.qCurveTo(point(end, 1, -1), point(end, normal=-1))
pen.lineTo(point(start, normal=-1))
pen.qCurveTo(point(start, -1, -1), point(start, -1))
pen.qCurveTo(point(start, -1, 1), point(start, normal=1))
pen.closePath()
diagonal = pen.glyph()

for codepoint, subset_codepoint in [(0x2ACB, 0x2286), (0x2ACC, 0x2287)]:
    name = font.getBestCmap()[codepoint]
    output = TTGlyphPen(None)
    flattened_curve(codepoint).replay(output)
    bar = contours(main, subset_codepoint)[1]
    bar.replay(output)
    bar.replay(TransformPen(output, (1, 0, 0, 1, 0, -100)))
    diagonal.draw(output, None)
    glyph = output.glyph()
    glyph.recalcBounds(font["glyf"])
    capital = main["glyf"][main.getBestCmap()[ord("B")]]
    # Include both lower bars and the slash when aligning the complete sign.
    shift = round((capital.yMin + capital.yMax - glyph.yMin - glyph.yMax) / 2)
    centered = TTGlyphPen(None)
    glyph.draw(TransformPen(centered, (1, 0, 0, 1, 0, shift)), None)
    font["glyf"][name] = centered.glyph()
    font["glyf"][name].recalcBounds(font["glyf"])
    font["hmtx"][name] = (778, font["glyf"][name].xMin)

options = subset.Options()
options.name_IDs = ["*"]
options.name_legacy = True
options.name_languages = ["*"]
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=[0x2ACB, 0x2ACC])
subsetter.subset(font)

names = {
    1: "DSH Set Relations", 2: "Regular", 3: "DSH Set Relations Regular 1.2",
    4: "DSH Set Relations Regular", 5: "Version 1.2", 6: "DSHSetRelations-Regular",
    16: "DSH Set Relations", 17: "Regular", 21: "DSH Set Relations", 22: "Regular",
}
for record in font["name"].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
font.flavor = "woff2"
font["head"].fontRevision = 1.2
font.save(args.output)
