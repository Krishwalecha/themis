// Search details for every public page, used twice: at build time to give each page its own HTML head (so crawlers
// that don't run JavaScript see the right title and canonical), and at runtime as the visitor moves between pages.
export const SITE = "https://usethemis.dev";

export const SEO: Record<string, { title: string; description: string }> = {
  "/": {
    title: "Themis · API testing, monitoring and contract validation",
    description:
      "Test, monitor and validate your APIs in one free workspace. Postman-style API testing, uptime monitoring and OpenAPI contract checks, with AI fixes.",
  },
  "/try": {
    title: "Try Themis free · Send an API request, no sign-up",
    description: "Send a request to any public API right in your browser: set headers, auth and a body, then see the status, timing and response. No account needed.",
  },
  "/signup": {
    title: "Create your free account · Themis",
    description: "Sign up free to save requests, use environments, run collections, monitor APIs on a schedule and validate responses against OpenAPI contracts.",
  },
  "/login": {
    title: "Sign in · Themis",
    description: "Sign in to Themis to test, monitor and validate your APIs.",
  },
  "/privacy": {
    title: "Privacy policy · Themis",
    description: "What Themis stores about you, why, who else processes it and how to delete it.",
  },
  "/terms": {
    title: "Terms of service · Themis",
    description: "The terms for using Themis, the API testing and monitoring workspace.",
  },
};
