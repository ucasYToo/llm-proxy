import { Command } from "commander";
import { ensureBackground } from "../../../lib/service-process";
import { startServer } from "../../../server";
import { startCommand } from "../start";

jest.mock("../../../lib/service-process", () => ({ ensureBackground: jest.fn() }));
jest.mock("../../../server", () => ({ startServer: jest.fn() }));
jest.mock("ora", () => () => ({ start: () => ({ succeed: jest.fn() }) }));

async function start(...args: string[]) {
  const program = new Command();
  startCommand(program);
  await program.parseAsync(["start", ...args], { from: "user" });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it("starts in the background with no arguments", async () => {
  await start();
  expect(ensureBackground).toHaveBeenCalledTimes(1);
  expect(startServer).not.toHaveBeenCalled();
});

it("runs the server directly when foreground mode is requested", async () => {
  await start("--foreground", "--no-statusbar");
  expect(startServer).toHaveBeenCalledTimes(1);
  expect(ensureBackground).not.toHaveBeenCalled();
});
