import chalk from "chalk";
import ora, { type Ora } from "ora";

const ICONS = {
  info: chalk.blue("ℹ"),
  success: chalk.green("✔"),
  warn: chalk.yellow("⚠"),
  error: chalk.red("✖"),
  step: chalk.cyan("→"),
  brain: chalk.magenta("🧠"),
  music: chalk.green("🎵"),
  travel: chalk.blue("✈️"),
  upload: chalk.yellow("📤"),
  screenshot: chalk.cyan("🖼️"),
  profile: chalk.magenta("👤"),
  search: chalk.blue("🔍"),
  spark: chalk.yellow("⚡"),
};

let currentSpinner: Ora | null = null;

export function log(icon: keyof typeof ICONS, message: string): void {
  if (currentSpinner) currentSpinner.stop();
  console.log(`  ${ICONS[icon]}  ${chalk.gray(message)}`);
  if (currentSpinner) currentSpinner.start();
}

export function logStep(step: number, total: number, message: string): void {
  if (currentSpinner) currentSpinner.stop();
  const stepStr = chalk.dim(`[${step}/${total}]`);
  console.log(`  ${ICONS.step}  ${stepStr} ${message}`);
  if (currentSpinner) currentSpinner.start();
}

export function logHeader(title: string): void {
  console.log();
  console.log(`  ${chalk.bold.underline(title)}`);
  console.log();
}

export function logDivider(): void {
  console.log(chalk.dim("  " + "─".repeat(60)));
}

export function startSpinner(text: string): Ora {
  currentSpinner = ora({
    text: chalk.dim(text),
    spinner: "dots",
    indent: 2,
  }).start();
  return currentSpinner;
}

export function stopSpinner(spinner: Ora, text: string, success = true): void {
  if (success) {
    spinner.succeed(chalk.green(text));
  } else {
    spinner.fail(chalk.red(text));
  }
  currentSpinner = null;
}

export function blank(): void {
  console.log();
}

export { ICONS };
