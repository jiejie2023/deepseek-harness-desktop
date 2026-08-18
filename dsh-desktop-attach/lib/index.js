import { spawn } from "node:child_process";
import { connect } from "node:net";
//#region src/index.ts
const name = "dsh-desktop-attach";
const DEFAULT_URL = "http://127.0.0.1:3080";
const DEFAULT_COMMAND = "dsh-desktop";
const DEFAULT_TIMEOUT_MS = 6e4;
const DEFAULT_POLL_INTERVAL_MS = 1e3;
/** Parse and validate the target URL into a connectable host/port pair. */
function parseTarget(url) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch (cause) {
		throw new Error(`dsh-desktop-attach: invalid url ${JSON.stringify(url)}: ${cause instanceof Error ? cause.message : String(cause)}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`dsh-desktop-attach: url must be an http(s) URL, got ${parsed.protocol}`);
	const port = parsed.port === "" ? parsed.protocol === "https:" ? 443 : 80 : Number(parsed.port);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`dsh-desktop-attach: invalid port ${JSON.stringify(parsed.port)}`);
	return {
		host: parsed.hostname,
		port
	};
}
function isNodeScript(command) {
	return /\.(mjs|cjs|js)$/i.test(command);
}
/**
* Mount the attach launcher. Waits for the Web surface to accept TCP
* connections, then spawns the configured launcher once. All timers and the
* child process are unref'd so they never keep the host alive.
* @returns a disposer that stops the poll timer.
*/
function apply(ctx, config) {
	if (config?.enabled === false) return () => {};
	let target;
	try {
		target = parseTarget(config?.url ?? DEFAULT_URL);
	} catch (cause) {
		ctx.logger.warn(cause instanceof Error ? cause.message : String(cause));
		return () => {};
	}
	const command = config?.command ?? DEFAULT_COMMAND;
	const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const pollIntervalMs = config?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const url = config?.url ?? DEFAULT_URL;
	const deadline = Date.now() + timeoutMs;
	let launched = false;
	const launch = () => {
		if (launched) return;
		launched = true;
		ctx.logger.info(`dsh-desktop-attach: opening ${url} via ${command}`);
		const child = isNodeScript(command) ? spawn(process.execPath, [
			command,
			"--attach",
			url
		], {
			stdio: "ignore",
			windowsHide: true
		}) : spawn(command, ["--attach", url], {
			stdio: "ignore",
			windowsHide: true
		});
		child.on("error", (cause) => {
			ctx.logger.warn(`dsh-desktop-attach: failed to start ${command}: ${cause.message}`);
		});
		child.unref();
	};
	let timer;
	timer = setInterval(() => {
		const socket = connect({
			host: target.host,
			port: target.port
		});
		let settled = false;
		const finish = (reachable) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			if (timer !== void 0) {
				clearInterval(timer);
				timer = void 0;
			}
			if (reachable) launch();
			else if (Date.now() >= deadline) ctx.logger.warn(`dsh-desktop-attach: ${url} never became reachable within ${timeoutMs}ms; not opening the window`);
		};
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
		socket.setTimeout(2e3, () => finish(false));
	}, pollIntervalMs);
	timer.unref();
	return () => {
		if (timer !== void 0) {
			clearInterval(timer);
			timer = void 0;
		}
	};
}
//#endregion
export { apply, name, parseTarget };

//# sourceMappingURL=index.js.map