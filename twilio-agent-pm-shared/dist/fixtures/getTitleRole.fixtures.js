export const GET_TITLE_ROLE_FIXTURES = [
    // ── SA ────────────────────────────────────────────────────────────────────
    { input: "Solutions Architect", expected: "SA" },
    { input: "Sr. Solutions Architect", expected: "SA" },
    { input: "SA", expected: "SA", note: "exact abbreviation" },
    { input: "sa", expected: "SA", note: "lowercase abbreviation" },
    // ── TAM (must match before MA) ────────────────────────────────────────────
    { input: "Technical Account Manager", expected: "TAM" },
    { input: "Senior Technical Account Manager", expected: "TAM" },
    { input: "TAM", expected: "TAM", note: "exact abbreviation" },
    // ── CSM ───────────────────────────────────────────────────────────────────
    { input: "Customer Success Manager", expected: "CSM" },
    { input: "CSM", expected: "CSM", note: "exact abbreviation" },
    { input: "Sr Customer Success Manager", expected: "CSM" },
    // ── PM (multiple synonyms) ────────────────────────────────────────────────
    { input: "Product Manager", expected: "PM" },
    { input: "Project Manager", expected: "PM" },
    { input: "Program Manager", expected: "PM" },
    { input: "PM", expected: "PM", note: "exact abbreviation" },
    // ── MA (generic manager, after TAM/CSM/PM) ────────────────────────────────
    { input: "Manager", expected: "MA" },
    { input: "Sales Manager", expected: "MA" },
    { input: "MA", expected: "MA", note: "exact abbreviation" },
    // ── AE ────────────────────────────────────────────────────────────────────
    { input: "Account Executive", expected: "AE" },
    { input: "AE", expected: "AE", note: "exact abbreviation" },
    // ── ENG ───────────────────────────────────────────────────────────────────
    { input: "Engineer", expected: "ENG" },
    { input: "Software Engineer", expected: "ENG" },
    { input: "ENG", expected: "ENG", note: "exact abbreviation" },
    // ── other / edge cases ────────────────────────────────────────────────────
    { input: null, expected: "other", note: "null input" },
    { input: undefined, expected: "other", note: "undefined input" },
    { input: "", expected: "other", note: "empty string" },
    { input: "Designer", expected: "other" },
    { input: "Intern", expected: "other" },
    // ── Specificity traps ────────────────────────────────────────────────────
    { input: "Technical Account Manager (TAM)", expected: "TAM", note: "TAM beats MA: 'manager' substring present" },
    { input: "Customer Success Manager (CSM)", expected: "CSM", note: "CSM beats MA: 'manager' substring present" },
];
//# sourceMappingURL=getTitleRole.fixtures.js.map