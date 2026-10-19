// Harness helper: resolve pi-coding-agent package directory.
// Priority:
//   1. PI_PACKAGE_DIR env var (explicit override)
//   2. npm root -g → @earendil-works/pi-coding-agent
//   3. Hard-coded fallback for known mise layout
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

function findPiPkg() {
	if (process.env.PI_PACKAGE_DIR) return process.env.PI_PACKAGE_DIR;

	// Try npm root -g
	try {
		const npmGlobal = execSync("npm root -g", { encoding: "utf8" }).trim();
		const candidate = path.join(npmGlobal, "@earendil-works/pi-coding-agent");
		if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
	} catch (_) {
		// ignore
	}

	// Fallback: mise node layout
	const miseBase = path.join(
		process.env.HOME ?? "/root",
		".local/share/mise/installs/node"
	);
	if (fs.existsSync(miseBase)) {
		const versions = fs.readdirSync(miseBase).sort().reverse();
		for (const ver of versions) {
			const candidate = path.join(
				miseBase,
				ver,
				"lib/node_modules/@earendil-works/pi-coding-agent"
			);
			if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
		}
	}

	throw new Error(
		"Cannot locate @earendil-works/pi-coding-agent. " +
		"Set PI_PACKAGE_DIR env var to its directory."
	);
}

export const PI_PKG = findPiPkg();

const req = createRequire(path.join(PI_PKG, "package.json"));
const { createJiti } = await import(pathToFileURL(req.resolve("jiti")).href);
const tuiDir = path.join(PI_PKG, "node_modules/@earendil-works/pi-tui");
const tuiMain = path.join(
	tuiDir,
	JSON.parse(fs.readFileSync(path.join(tuiDir, "package.json"), "utf8")).main
);

export function loadTs(file) {
	const jiti = createJiti(import.meta.url, {
		moduleCache: false,
		alias: {
			"@earendil-works/pi-tui": tuiMain,
			"@earendil-works/pi-coding-agent": path.join(PI_PKG, "dist/index.js"),
		},
	});
	return jiti.import(file);
}
