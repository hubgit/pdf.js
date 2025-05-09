/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { DrawOPS, info, OPS } from "../shared/util.js";
import { getEncoding, StandardEncoding } from "./encodings.js";
import { getGlyphsUnicode } from "./glyphlist.js";
import { getLookupTableFactory } from "./core_utils.js";
import { getUnicodeForGlyph } from "./unicode.js";

// Accented characters have issues on Windows and Linux. When this flag is
// enabled glyphs that use seac and seac style endchar operators are truncated
// and we instead just store the glyph id's of the base glyph and its accent to
// be drawn individually.
// Linux (freetype) requires that when a seac style endchar is used
// that the charset must be a predefined one, however we build a
// custom one. Windows just refuses to draw glyphs with seac operators.
const SEAC_ANALYSIS_ENABLED = true;

const FontFlags = {
  FixedPitch: 1,
  Serif: 2,
  Symbolic: 4,
  Script: 8,
  Nonsymbolic: 32,
  Italic: 64,
  AllCap: 65536,
  SmallCap: 131072,
  ForceBold: 262144,
};

// prettier-ignore
const MacStandardGlyphOrdering = [
  ".notdef", ".null", "nonmarkingreturn", "space", "exclam", "quotedbl",
  "numbersign", "dollar", "percent", "ampersand", "quotesingle", "parenleft",
  "parenright", "asterisk", "plus", "comma", "hyphen", "period", "slash",
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "colon", "semicolon", "less", "equal", "greater", "question", "at",
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O",
  "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "bracketleft",
  "backslash", "bracketright", "asciicircum", "underscore", "grave", "a", "b",
  "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q",
  "r", "s", "t", "u", "v", "w", "x", "y", "z", "braceleft", "bar", "braceright",
  "asciitilde", "Adieresis", "Aring", "Ccedilla", "Eacute", "Ntilde",
  "Odieresis", "Udieresis", "aacute", "agrave", "acircumflex", "adieresis",
  "atilde", "aring", "ccedilla", "eacute", "egrave", "ecircumflex", "edieresis",
  "iacute", "igrave", "icircumflex", "idieresis", "ntilde", "oacute", "ograve",
  "ocircumflex", "odieresis", "otilde", "uacute", "ugrave", "ucircumflex",
  "udieresis", "dagger", "degree", "cent", "sterling", "section", "bullet",
  "paragraph", "germandbls", "registered", "copyright", "trademark", "acute",
  "dieresis", "notequal", "AE", "Oslash", "infinity", "plusminus", "lessequal",
  "greaterequal", "yen", "mu", "partialdiff", "summation", "product", "pi",
  "integral", "ordfeminine", "ordmasculine", "Omega", "ae", "oslash",
  "questiondown", "exclamdown", "logicalnot", "radical", "florin",
  "approxequal", "Delta", "guillemotleft", "guillemotright", "ellipsis",
  "nonbreakingspace", "Agrave", "Atilde", "Otilde", "OE", "oe", "endash",
  "emdash", "quotedblleft", "quotedblright", "quoteleft", "quoteright",
  "divide", "lozenge", "ydieresis", "Ydieresis", "fraction", "currency",
  "guilsinglleft", "guilsinglright", "fi", "fl", "daggerdbl", "periodcentered",
  "quotesinglbase", "quotedblbase", "perthousand", "Acircumflex",
  "Ecircumflex", "Aacute", "Edieresis", "Egrave", "Iacute", "Icircumflex",
  "Idieresis", "Igrave", "Oacute", "Ocircumflex", "apple", "Ograve", "Uacute",
  "Ucircumflex", "Ugrave", "dotlessi", "circumflex", "tilde", "macron",
  "breve", "dotaccent", "ring", "cedilla", "hungarumlaut", "ogonek", "caron",
  "Lslash", "lslash", "Scaron", "scaron", "Zcaron", "zcaron", "brokenbar",
  "Eth", "eth", "Yacute", "yacute", "Thorn", "thorn", "minus", "multiply",
  "onesuperior", "twosuperior", "threesuperior", "onehalf", "onequarter",
  "threequarters", "franc", "Gbreve", "gbreve", "Idotaccent", "Scedilla",
  "scedilla", "Cacute", "cacute", "Ccaron", "ccaron", "dcroat"];

// Some bad PDF generators, e.g. Scribus PDF, include glyph names
// in a 'uniXXXX' format -- attempting to recover proper ones.
function recoverGlyphName(name, glyphsUnicodeMap) {
  if (glyphsUnicodeMap[name] !== undefined) {
    return name;
  }
  // The glyph name is non-standard, trying to recover.
  const unicode = getUnicodeForGlyph(name, glyphsUnicodeMap);
  if (unicode !== -1) {
    for (const key in glyphsUnicodeMap) {
      if (glyphsUnicodeMap[key] === unicode) {
        return key;
      }
    }
  }
  info("Unable to recover a standard glyph name for: " + name);
  return name;
}

/**
 * Shared logic for building a char code to glyph id mapping for Type1 and
 * simple CFF fonts. See section 9.6.6.2 of the spec.
 * @param {Object} properties Font properties object.
 * @param {Object} builtInEncoding The encoding contained within the actual font
 *   data.
 * @param {Array} glyphNames Array of glyph names where the index is the
 *   glyph ID.
 * @returns {Object} A char code to glyph ID map.
 */
function type1FontGlyphMapping(properties, builtInEncoding, glyphNames) {
  const charCodeToGlyphId = Object.create(null);
  let glyphId, charCode, baseEncoding;
  const isSymbolicFont = !!(properties.flags & FontFlags.Symbolic);

  if (properties.isInternalFont) {
    baseEncoding = builtInEncoding;
    for (charCode = 0; charCode < baseEncoding.length; charCode++) {
      glyphId = glyphNames.indexOf(baseEncoding[charCode]);
      charCodeToGlyphId[charCode] = glyphId >= 0 ? glyphId : /* notdef = */ 0;
    }
  } else if (properties.baseEncodingName) {
    // If a valid base encoding name was used, the mapping is initialized with
    // that.
    baseEncoding = getEncoding(properties.baseEncodingName);
    for (charCode = 0; charCode < baseEncoding.length; charCode++) {
      glyphId = glyphNames.indexOf(baseEncoding[charCode]);
      charCodeToGlyphId[charCode] = glyphId >= 0 ? glyphId : /* notdef = */ 0;
    }
  } else if (isSymbolicFont) {
    // For a symbolic font the encoding should be the fonts built-in encoding.
    for (charCode in builtInEncoding) {
      charCodeToGlyphId[charCode] = builtInEncoding[charCode];
    }
  } else {
    // For non-symbolic fonts that don't have a base encoding the standard
    // encoding should be used.
    baseEncoding = StandardEncoding;
    for (charCode = 0; charCode < baseEncoding.length; charCode++) {
      glyphId = glyphNames.indexOf(baseEncoding[charCode]);
      charCodeToGlyphId[charCode] = glyphId >= 0 ? glyphId : /* notdef = */ 0;
    }
  }

  // Lastly, merge in the differences.
  const differences = properties.differences;
  let glyphsUnicodeMap;
  if (differences) {
    for (charCode in differences) {
      const glyphName = differences[charCode];
      glyphId = glyphNames.indexOf(glyphName);

      if (glyphId === -1) {
        if (!glyphsUnicodeMap) {
          glyphsUnicodeMap = getGlyphsUnicode();
        }
        const standardGlyphName = recoverGlyphName(glyphName, glyphsUnicodeMap);
        if (standardGlyphName !== glyphName) {
          glyphId = glyphNames.indexOf(standardGlyphName);
        }
      }
      charCodeToGlyphId[charCode] = glyphId >= 0 ? glyphId : /* notdef = */ 0;
    }
  }
  return charCodeToGlyphId;
}

function normalizeFontName(name) {
  return name.replaceAll(/[,_]/g, "-").replaceAll(/\s/g, "");
}

const getVerticalPresentationForm = getLookupTableFactory(t => {
  // This table has been found at
  // https://searchfox.org/mozilla-central/rev/cbdfa503a87597b20719aae5f6a1efccd6cb3b7b/gfx/thebes/gfxHarfBuzzShaper.cpp#251-294
  t[0x2013] = 0xfe32; // EN DASH
  t[0x2014] = 0xfe31; // EM DASH
  t[0x2025] = 0xfe30; // TWO DOT LEADER
  t[0x2026] = 0xfe19; // HORIZONTAL ELLIPSIS
  t[0x3001] = 0xfe11; // IDEOGRAPHIC COMMA
  t[0x3002] = 0xfe12; // IDEOGRAPHIC FULL STOP
  t[0x3008] = 0xfe3f; // LEFT ANGLE BRACKET
  t[0x3009] = 0xfe40; // RIGHT ANGLE BRACKET
  t[0x300a] = 0xfe3d; // LEFT DOUBLE ANGLE BRACKET
  t[0x300b] = 0xfe3e; // RIGHT DOUBLE ANGLE BRACKET
  t[0x300c] = 0xfe41; // LEFT CORNER BRACKET
  t[0x300d] = 0xfe42; // RIGHT CORNER BRACKET
  t[0x300e] = 0xfe43; // LEFT WHITE CORNER BRACKET
  t[0x300f] = 0xfe44; // RIGHT WHITE CORNER BRACKET
  t[0x3010] = 0xfe3b; // LEFT BLACK LENTICULAR BRACKET
  t[0x3011] = 0xfe3c; // RIGHT BLACK LENTICULAR BRACKET
  t[0x3014] = 0xfe39; // LEFT TORTOISE SHELL BRACKET
  t[0x3015] = 0xfe3a; // RIGHT TORTOISE SHELL BRACKET
  t[0x3016] = 0xfe17; // LEFT WHITE LENTICULAR BRACKET
  t[0x3017] = 0xfe18; // RIGHT WHITE LENTICULAR BRACKET
  t[0xfe4f] = 0xfe34; // WAVY LOW LINE
  t[0xff01] = 0xfe15; // FULLWIDTH EXCLAMATION MARK
  t[0xff08] = 0xfe35; // FULLWIDTH LEFT PARENTHESIS
  t[0xff09] = 0xfe36; // FULLWIDTH RIGHT PARENTHESIS
  t[0xff0c] = 0xfe10; // FULLWIDTH COMMA
  t[0xff1a] = 0xfe13; // FULLWIDTH COLON
  t[0xff1b] = 0xfe14; // FULLWIDTH SEMICOLON
  t[0xff1f] = 0xfe16; // FULLWIDTH QUESTION MARK
  t[0xff3b] = 0xfe47; // FULLWIDTH LEFT SQUARE BRACKET
  t[0xff3d] = 0xfe48; // FULLWIDTH RIGHT SQUARE BRACKET
  t[0xff3f] = 0xfe33; // FULLWIDTH LOW LINE
  t[0xff5b] = 0xfe37; // FULLWIDTH LEFT CURLY BRACKET
  t[0xff5d] = 0xfe38; // FULLWIDTH RIGHT CURLY BRACKET
});

// To disable Type3 compilation, set the value to `-1`.
const MAX_SIZE_TO_COMPILE = 1000;

function compileType3Glyph({ data: img, width, height }) {
  if (width > MAX_SIZE_TO_COMPILE || height > MAX_SIZE_TO_COMPILE) {
    return null;
  }

  const POINT_TO_PROCESS_LIMIT = 1000;
  const POINT_TYPES = new Uint8Array([
    0, 2, 4, 0, 1, 0, 5, 4, 8, 10, 0, 8, 0, 2, 1, 0,
  ]);

  const width1 = width + 1;
  const points = new Uint8Array(width1 * (height + 1));
  let i, j, j0;

  // decodes bit-packed mask data
  const lineSize = (width + 7) & ~7;
  const data = new Uint8Array(lineSize * height);
  let pos = 0;
  for (const elem of img) {
    let mask = 128;
    while (mask > 0) {
      data[pos++] = elem & mask ? 0 : 255;
      mask >>= 1;
    }
  }

  // finding interesting points: every point is located between mask pixels,
  // so there will be points of the (width + 1)x(height + 1) grid. Every point
  // will have flags assigned based on neighboring mask pixels:
  //   4 | 8
  //   --P--
  //   2 | 1
  // We are interested only in points with the flags:
  //   - outside corners: 1, 2, 4, 8;
  //   - inside corners: 7, 11, 13, 14;
  //   - and, intersections: 5, 10.
  let count = 0;
  pos = 0;
  if (data[pos] !== 0) {
    points[0] = 1;
    ++count;
  }
  for (j = 1; j < width; j++) {
    if (data[pos] !== data[pos + 1]) {
      points[j] = data[pos] ? 2 : 1;
      ++count;
    }
    pos++;
  }
  if (data[pos] !== 0) {
    points[j] = 2;
    ++count;
  }
  for (i = 1; i < height; i++) {
    pos = i * lineSize;
    j0 = i * width1;
    if (data[pos - lineSize] !== data[pos]) {
      points[j0] = data[pos] ? 1 : 8;
      ++count;
    }
    // 'sum' is the position of the current pixel configuration in the 'TYPES'
    // array (in order 8-1-2-4, so we can use '>>2' to shift the column).
    let sum = (data[pos] ? 4 : 0) + (data[pos - lineSize] ? 8 : 0);
    for (j = 1; j < width; j++) {
      sum =
        (sum >> 2) +
        (data[pos + 1] ? 4 : 0) +
        (data[pos - lineSize + 1] ? 8 : 0);
      if (POINT_TYPES[sum]) {
        points[j0 + j] = POINT_TYPES[sum];
        ++count;
      }
      pos++;
    }
    if (data[pos - lineSize] !== data[pos]) {
      points[j0 + j] = data[pos] ? 2 : 4;
      ++count;
    }

    if (count > POINT_TO_PROCESS_LIMIT) {
      return null;
    }
  }

  pos = lineSize * (height - 1);
  j0 = i * width1;
  if (data[pos] !== 0) {
    points[j0] = 8;
    ++count;
  }
  for (j = 1; j < width; j++) {
    if (data[pos] !== data[pos + 1]) {
      points[j0 + j] = data[pos] ? 4 : 8;
      ++count;
    }
    pos++;
  }
  if (data[pos] !== 0) {
    points[j0 + j] = 4;
    ++count;
  }
  if (count > POINT_TO_PROCESS_LIMIT) {
    return null;
  }

  // building outlines
  const steps = new Int32Array([0, width1, -1, 0, -width1, 0, 0, 0, 1]);
  const pathBuf = [];

  // the path shall be painted in [0..1]x[0..1] space
  const { a, b, c, d, e, f } = new DOMMatrix()
    .scaleSelf(1 / width, -1 / height)
    .translateSelf(0, -height);

  for (i = 0; count && i <= height; i++) {
    let p = i * width1;
    const end = p + width;
    while (p < end && !points[p]) {
      p++;
    }
    if (p === end) {
      continue;
    }
    let x = p % width1;
    let y = i;
    pathBuf.push(DrawOPS.moveTo, a * x + c * y + e, b * x + d * y + f);

    const p0 = p;
    let type = points[p];
    do {
      const step = steps[type];
      do {
        p += step;
      } while (!points[p]);

      const pp = points[p];
      if (pp !== 5 && pp !== 10) {
        // set new direction
        type = pp;
        // delete mark
        points[p] = 0;
      } else {
        // type is 5 or 10, ie, a crossing
        // set new direction
        type = pp & ((0x33 * type) >> 4);
        // set new type for "future hit"
        points[p] &= (type >> 2) | (type << 2);
      }
      x = p % width1;
      y = (p / width1) | 0;
      pathBuf.push(DrawOPS.lineTo, a * x + c * y + e, b * x + d * y + f);

      if (!points[p]) {
        --count;
      }
    } while (p0 !== p);
    --i;
  }

  return [
    OPS.rawFillPath,
    [new Float32Array(pathBuf)],
    new Float32Array([0, 0, width, height]),
  ];
}

export {
  compileType3Glyph,
  FontFlags,
  getVerticalPresentationForm,
  MacStandardGlyphOrdering,
  normalizeFontName,
  recoverGlyphName,
  SEAC_ANALYSIS_ENABLED,
  type1FontGlyphMapping,
};
