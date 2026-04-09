import { spawn } from "node:child_process";

const cliArgs = process.argv.slice(2);
const npmHost = process.env.npm_config_host;
const forwardedArgs = [...cliArgs];
const hasExplicitHostArg = forwardedArgs.some(
  (arg) => arg === "--host" || arg.startsWith("--host="),
);

if (npmHost && !hasExplicitHostArg) {
  if (npmHost === "true") {
    const nextArg = forwardedArgs[0];

    if (nextArg && !nextArg.startsWith("-")) {
      forwardedArgs.shift();
      forwardedArgs.unshift("--host", nextArg);
    } else {
      forwardedArgs.unshift("--host");
    }
  } else {
    if (forwardedArgs[0] === npmHost) {
      forwardedArgs.shift();
    }
    forwardedArgs.unshift("--host", npmHost);
  }
} else if (npmHost && forwardedArgs[0] === npmHost) {
  // Avoid passing a duplicated host value when npm preserved it as a positional arg.
  forwardedArgs.shift();
}

const child = spawn(
  "pnpm",
  ["--filter", "@code-dance/web", "dev", ...forwardedArgs],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
