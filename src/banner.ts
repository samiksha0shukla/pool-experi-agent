import figlet from "figlet";
import gradient from "gradient-string";
import chalk from "chalk";

const poolGradient = gradient(["#6C5CE7", "#A29BFE", "#74B9FF", "#0984E3"]);

export function showBanner(): void {
  console.clear();

  const ascii = figlet.textSync("Pool Agent", {
    font: "ANSI Shadow",
    horizontalLayout: "fitted",
  });

  console.log();
  console.log(poolGradient(ascii));
  console.log();
  console.log(
    chalk.dim("  ") +
      chalk.bgHex("#6C5CE7").white.bold(" POOL ") +
      chalk.dim("  Screenshot Intelligence Agent") +
      chalk.dim("  v1.0.0")
  );
  console.log();
  console.log(
    chalk.dim("  ─────────────────────────────────────────────────────────")
  );
  console.log(
    chalk.dim("  ") +
      chalk.hex("#A29BFE")("🎵 Music Agent") +
      chalk.dim("  ·  ") +
      chalk.hex("#74B9FF")("✈️  Travel Agent") +
      chalk.dim("  ·  ") +
      chalk.hex("#6C5CE7")("👤 Profile Builder")
  );
  console.log(
    chalk.dim("  ─────────────────────────────────────────────────────────")
  );
  console.log();
}
