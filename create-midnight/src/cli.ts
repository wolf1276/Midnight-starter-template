#!/usr/bin/env node
import { Command } from 'commander';
import * as clack from '@clack/prompts';
import ora from 'ora';
import pc from 'picocolors';
import logSymbols from 'log-symbols';

import { printBanner, collectAnswers, type CliFlags, type Network } from './prompts.js';
import { downloadTemplate, resolveTemplate } from './downloader.js';
import { configureProject } from './scaffold.js';
import { installDependencies } from './installer.js';
import { initGitRepo } from './git.js';
import { runProjectSetup } from './setup.js';
import { CLIError, printError } from './errors.js';
import { assertTargetAvailable, detectPackageManager } from './utils.js';
import { setVerbose, verbose } from './logger.js';

const program = new Command();

program
  .name('create-midnight')
  .description('Scaffold a production-ready Midnight DApp')
  .argument('[project-name]', 'Name of the project / target directory')
  .option('--template <name>', 'Template to scaffold', 'starter')
  .option(
    '--ref <ref>',
    'Override the version-locked template ref (branch/tag/commit), e.g. main, develop, v1.1.0. Development use only — bypasses reproducibility guarantees.'
  )
  .option('--network <network>', 'Default network: preview | preprod')
  .option('--git', 'Initialize a git repository')
  .option('--no-git', 'Skip git initialization')
  .option('--install', 'Install dependencies')
  .option('--no-install', 'Skip dependency installation')
  .option('--setup', 'Run project setup after installation')
  .option('--no-setup', 'Skip project setup')
  .option('--use-npm', 'Force npm as the package manager')
  .option('--use-pnpm', 'Force pnpm as the package manager')
  .option('--use-yarn', 'Force yarn as the package manager')
  .option('--use-bun', 'Force bun as the package manager')
  .option('-y, --yes', 'Accept defaults for all prompts', false)
  .option('--verbose', 'Print full error output for debugging', false)
  .parse(process.argv);

async function main(): Promise<void> {
  const opts = program.opts();
  const [projectNameArg] = program.args;

  setVerbose(Boolean(opts.verbose));

  if (opts.network && !['preview', 'preprod'].includes(opts.network)) {
    throw new CLIError('UNKNOWN', `--network must be "preview" or "preprod", got "${opts.network}".`);
  }

  printBanner();

  const flags: CliFlags = {
    projectName: projectNameArg,
    template: opts.template,
    network: opts.network as Network | undefined,
    git: opts.git,
    install: opts.install,
    setup: opts.setup,
    yes: Boolean(opts.yes),
    verbose: Boolean(opts.verbose)
  };

  const answers = await collectAnswers(flags);
  assertTargetAvailable(answers.targetDir);

  const templateSource = resolveTemplate(answers.template, opts.ref);
  if (templateSource.refSource === 'override') {
    console.log(
      pc.yellow(
        `  ${logSymbols.warning} Using --ref override "${templateSource.ref}" instead of the version-locked template. This is for development only and is not guaranteed to be reproducible.`
      )
    );
  } else {
    verbose(`Scaffolding from version-locked template ref ${templateSource.ref}`);
  }

  const pmOverride = opts.useNpm
    ? 'npm'
    : opts.usePnpm
      ? 'pnpm'
      : opts.useYarn
        ? 'yarn'
        : opts.useBun
          ? 'bun'
          : undefined;
  const pm = detectPackageManager(pmOverride);

  console.log('');
  console.log(pc.dim('━'.repeat(28)));
  console.log('');

  await step('Downloading template', () => downloadTemplate(templateSource, answers.targetDir), {
    successLabel: 'Downloaded template'
  });

  await step('Configuring project', () =>
    configureProject({
      targetDir: answers.targetDir,
      packageName: answers.packageName,
      network: answers.network
    }), { successLabel: 'Project configured' });

  if (answers.installDeps) {
    await step('Installing dependencies', () => installDependencies(answers.targetDir, pm), {
      successLabel: 'Dependencies installed'
    });
  }

  if (answers.initGit) {
    await step('Initializing Git', () => initGitRepo(answers.targetDir), {
      successLabel: 'Git initialized',
      // A failed commit (e.g. missing git identity) shouldn't abort the whole run.
      tolerateFailure: true
    });
  }

  if (answers.runSetup && answers.installDeps) {
    await step('Running setup', () => runProjectSetup(answers.targetDir, pm), {
      successLabel: 'Environment ready'
    });
  } else if (answers.runSetup && !answers.installDeps) {
    console.log(`  ${logSymbols.warning} ${pc.yellow('Skipping setup: --setup requires dependencies to be installed (remove --no-install).')}`);
  }

  console.log('');
  console.log(pc.dim('━'.repeat(28)));

  printSuccessScreen(answers);
}

interface StepOptions {
  successLabel: string;
  tolerateFailure?: boolean;
}

async function step(label: string, fn: () => Promise<void>, options: StepOptions): Promise<void> {
  const spinner = ora({ text: label, color: 'magenta' }).start();
  try {
    await fn();
    spinner.succeed(options.successLabel);
  } catch (error) {
    spinner.fail(label);
    if (options.tolerateFailure && error instanceof CLIError) {
      console.log(`  ${logSymbols.warning} ${pc.yellow(error.message)}`);
      return;
    }
    throw error;
  }
}

function printSuccessScreen(answers: Awaited<ReturnType<typeof collectAnswers>>): void {
  const networkLabel = answers.network === 'preview' ? 'Preview' : 'Preprod';

  console.log('');
  console.log(pc.bold(`🎉 Your Midnight DApp is ready!`));
  console.log('');
  console.log(pc.bold('Project'));
  console.log(`  ${answers.projectName}`);
  console.log('');
  console.log(pc.bold('Network'));
  console.log(`  ${networkLabel}`);
  console.log('');
  console.log(pc.bold('Frontend'));
  console.log(`  http://localhost:3000`);
  console.log('');
  console.log(pc.bold('Next steps'));
  console.log(`  ${pc.cyan(`cd ${answers.projectName}`)}`);
  if (!answers.installDeps) console.log(`  ${pc.cyan('npm install')}`);
  if (!answers.runSetup) console.log(`  ${pc.cyan('npm run setup')}`);
  console.log(`  ${pc.cyan('npm run dev')}`);
  console.log('');
  console.log(`  ${pc.cyan('cd contracts')}`);
  console.log(`  ${pc.cyan('npm run deploy')}`);
  console.log('');
  console.log(pc.dim('━'.repeat(28)));
  console.log('');
  console.log(pc.bold('Useful links'));
  console.log(`  README.md`);
  console.log(`  Official Midnight Documentation - https://docs.midnight.network`);
  console.log('');
  console.log('Happy building! 🚀');
  console.log('');
}

main().catch((error: unknown) => {
  printError(error, Boolean(program.opts().verbose));
  process.exitCode = 1;
});
