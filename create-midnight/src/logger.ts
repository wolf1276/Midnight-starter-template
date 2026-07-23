import pc from 'picocolors';

export function banner(): void {
  console.log('');
  console.log(pc.bold(pc.magenta('✨ Welcome to Create Midnight')));
  console.log('');
  console.log(`Let's build your first Midnight DApp.`);
  console.log('');
}

export function rule(): void {
  console.log(pc.dim('━'.repeat(28)));
}

export function section(title: string): void {
  console.log('');
  console.log(pc.bold(title));
}

let verboseEnabled = false;

export function setVerbose(value: boolean): void {
  verboseEnabled = value;
}

export function verbose(message: string): void {
  if (verboseEnabled) {
    console.log(pc.dim(`  [verbose] ${message}`));
  }
}
