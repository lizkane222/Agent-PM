import { fileIcon, attachLinkIcon, fmtBytes, fmtTime, formatArr } from "../brain/formatters.js";
import {
  FILE_ICON_FIXTURES,
  ATTACH_LINK_ICON_FIXTURES,
  FMT_BYTES_FIXTURES,
  FMT_TIME_FIXTURES,
  FORMAT_ARR_FIXTURES,
} from "../fixtures/fileIcon.fixtures.js";

describe("fileIcon", () => {
  for (const f of FILE_ICON_FIXTURES) {
    it(`mime="${f.mime}" name="${f.name}" → "${f.expected}"`, () => {
      expect(fileIcon(f.mime, f.name)).toBe(f.expected);
    });
  }
});

describe("attachLinkIcon", () => {
  for (const f of ATTACH_LINK_ICON_FIXTURES) {
    it(`url="${f.url}" → "${f.expected}"`, () => {
      expect(attachLinkIcon(f.url)).toBe(f.expected);
    });
  }
});

describe("fmtBytes", () => {
  for (const f of FMT_BYTES_FIXTURES) {
    it(`${f.bytes} → "${f.expected}"`, () => {
      expect(fmtBytes(f.bytes)).toBe(f.expected);
    });
  }
});

describe("fmtTime", () => {
  for (const f of FMT_TIME_FIXTURES) {
    it(`${f.seconds}s → "${f.expected}"`, () => {
      expect(fmtTime(f.seconds)).toBe(f.expected);
    });
  }
});

describe("formatArr", () => {
  for (const f of FORMAT_ARR_FIXTURES) {
    it(`"${f.input}" → "${f.expected}"`, () => {
      expect(formatArr(f.input)).toBe(f.expected);
    });
  }
});
