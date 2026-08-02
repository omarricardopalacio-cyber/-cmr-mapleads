// Deliberately separate from build.js: this makes a local-only extension bundle.
process.env.MAPLE_DESKTOP_PILOT = "1";
await import("./build.js");
