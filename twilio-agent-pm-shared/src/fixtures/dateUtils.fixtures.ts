// dateToLocalISO, toLocalISO, addMsToLocalISO
// These are timezone-aware; fixtures document the invariants (structure + offset)
// since exact UTC offset varies by test environment timezone.

export interface LocalIsoFixture {
  input: string;         // "YYYY-MM-DDTHH:MM:SS" local string
  expectedDate: string;  // YYYY-MM-DD portion must match
  expectedTime: string;  // HH:MM:SS portion must match
  note?: string;
}

export const TO_LOCAL_ISO_FIXTURES: LocalIsoFixture[] = [
  {
    input: "2024-03-15T09:30:00",
    expectedDate: "2024-03-15",
    expectedTime: "09:30:00",
    note: "time portion must be preserved verbatim",
  },
  {
    input: "2024-12-31T23:59:59",
    expectedDate: "2024-12-31",
    expectedTime: "23:59:59",
    note: "end-of-day/year boundary",
  },
];

export interface AddMsFixture {
  localStr: string;
  ms: number;
  expectedDate: string;
  expectedTime: string;
  note?: string;
}

export const ADD_MS_TO_LOCAL_ISO_FIXTURES: AddMsFixture[] = [
  {
    localStr: "2024-03-15T09:00:00",
    ms: 3600000, // +1 hour
    expectedDate: "2024-03-15",
    expectedTime: "10:00:00",
    note: "+1 hour same day",
  },
  {
    localStr: "2024-03-15T23:30:00",
    ms: 3600000, // +1 hour crosses midnight
    expectedDate: "2024-03-16",
    expectedTime: "00:30:00",
    note: "+1 hour crosses midnight",
  },
  {
    localStr: "2024-03-15T09:00:00",
    ms: 1800000, // +30 min
    expectedDate: "2024-03-15",
    expectedTime: "09:30:00",
    note: "+30 minutes",
  },
];
