// fileIcon(mime, name) → emoji
// attachLinkIcon(url) → emoji
// fmtBytes(bytes) → string
// fmtTime(seconds) → string
// formatArr(arr) → string

export interface FileIconFixture {
  mime: string;
  name: string;
  expected: string;
}

export const FILE_ICON_FIXTURES: FileIconFixture[] = [
  { mime: "image/png", name: "photo.png", expected: "🖼️" },
  { mime: "image/jpeg", name: "photo.jpg", expected: "🖼️" },
  { mime: "application/pdf", name: "doc.pdf", expected: "📄" },
  { mime: "video/mp4", name: "video.mp4", expected: "🎬" },
  { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name: "sheet.xlsx", expected: "📊" },
  { mime: "text/csv", name: "data.csv", expected: "📊" },
  { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", name: "doc.docx", expected: "📝" },
  { mime: "application/msword", name: "doc.doc", expected: "📝" },
  { mime: "application/octet-stream", name: "archive.zip", expected: "📎", },
  { mime: "", name: "unknown", expected: "📎", },
];

export interface AttachLinkIconFixture {
  url: string;
  expected: string;
}

export const ATTACH_LINK_ICON_FIXTURES: AttachLinkIconFixture[] = [
  { url: "https://www.figma.com/file/abc", expected: "🎨" },
  { url: "https://notion.so/page", expected: "📓" },
  { url: "https://docs.google.com/document/d/123", expected: "📄" },
  { url: "https://drive.google.com/file/d/123", expected: "📄" },
  { url: "https://github.com/org/repo", expected: "💻" },
  { url: "https://twilio.slack.com/archives/C123", expected: "💬" },
  { url: "https://example.com/page", expected: "🔗", },
  { url: "", expected: "🔗", },
];

export interface FmtBytesFixture {
  bytes: number | null;
  expected: string;
}

export const FMT_BYTES_FIXTURES: FmtBytesFixture[] = [
  { bytes: null, expected: "" },
  { bytes: 0, expected: "" },
  { bytes: 512, expected: "512 B" },
  { bytes: 1024, expected: "1.0 KB" },
  { bytes: 1536, expected: "1.5 KB" },
  { bytes: 1048576, expected: "1.0 MB" },
  { bytes: 1572864, expected: "1.5 MB" },
];

export interface FmtTimeFixture {
  seconds: number;
  expected: string;
}

export const FMT_TIME_FIXTURES: FmtTimeFixture[] = [
  { seconds: 0, expected: "0:00" },
  { seconds: 59, expected: "0:59" },
  { seconds: 60, expected: "1:00" },
  { seconds: 90, expected: "1:30" },
  { seconds: 3600, expected: "1:00:00" },
  { seconds: 3661, expected: "1:01:01" },
  { seconds: 7384, expected: "2:03:04" },
];

export interface FormatArrFixture {
  input: string | null;
  expected: string;
}

export const FORMAT_ARR_FIXTURES: FormatArrFixture[] = [
  { input: null, expected: "—" },
  { input: "", expected: "—" },
  { input: "500", expected: "$500" },
  { input: "999", expected: "$999" },
  { input: "1000", expected: "$1K" },
  { input: "500000", expected: "$500K" },
  { input: "999999", expected: "$1000K" },
  { input: "1000000", expected: "$1.0M" },
  { input: "2500000", expected: "$2.5M" },
];
