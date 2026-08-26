import chalk from "chalk";
import ora, { Ora } from "ora";

/**
 * UI Helper Functions
 */

function success(message: string): void {
  console.log(chalk.green(`\n✓ ${message}\n`));
}

function error(message: string): void {
  console.log(chalk.red(`\n✗ ${message}\n`));
}

function info(message: string): void {
  console.log(chalk.blue(`\n${message}\n`));
}

function warn(message: string): void {
  console.log(chalk.yellow(`\n⚠ ${message}\n`));
}

function gray(message: string): void {
  console.log(chalk.gray(message));
}

export function spinner(text: string): Ora {
  return ora(text);
}

function printSection(title: string): void {
  console.log(chalk.blue(`\n${title}\n`));
}

function printKeyValue(key: string, value: string, isSuccess: boolean = false): void {
  const color = isSuccess ? chalk.green : chalk.gray;
  console.log(color(`  ${key}: ${value}`));
}

function printList(items: string[], isSuccess: boolean = false): void {
  const symbol: string = isSuccess ? "✓" : "✗";
  const color = isSuccess ? chalk.green : chalk.gray;
  items.forEach((item: string) => {
    console.log(color(`  ${symbol} ${item}`));
  });
}
