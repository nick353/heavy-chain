import path from 'node:path';
import process from 'node:process';

import { buildPrintingApprovalReport, writePrintingApprovalPack } from './lib/printing-approval-pack.ts';

const getOption = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const repositoryRoot = process.cwd();
const manifestPath = path.resolve(
  getOption('--manifest') ?? path.join(repositoryRoot, 'benchmarks/printing-approval-v1/manifest.json'),
);
const outputValue = getOption('--output');
if (!outputValue) {
  console.error('PRINTING_APPROVAL_OUTPUT_REQUIRED: pass --output with a repository-external directory');
  process.exitCode = 2;
} else {
  const outputDirectory = path.resolve(outputValue);
  const relative = path.relative(repositoryRoot, outputDirectory);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    console.error('PRINTING_APPROVAL_OUTPUT_MUST_BE_REPOSITORY_EXTERNAL');
    process.exitCode = 2;
  } else {
    try {
      const report = await buildPrintingApprovalReport({
        manifestPath,
        outputDirectory,
        decisionPath: getOption('--decision'),
      });
      const paths = await writePrintingApprovalPack(report);
      const allowIncomplete = process.argv.includes('--allow-incomplete');
      const failed =
        !report.evidenceValid ||
        report.qualityFailures.length > 0 ||
        report.decisionIssue !== null ||
        (!allowIncomplete && !report.evidenceComplete);
      console.log(
        JSON.stringify(
          {
            ...paths,
            evidenceValid: report.evidenceValid,
            evidenceComplete: report.evidenceComplete,
            qualityGatePassed: report.qualityGatePassed,
            readyForUserApproval: report.readyForUserApproval,
            checkpointApproval: report.checkpointApproval,
            invalidIssues: report.invalidIssues.length,
            incompleteIssues: report.incompleteIssues.length,
            qualityFailures: report.qualityFailures.length,
            evidenceCoreDigest: report.evidenceCoreDigest,
          },
          null,
          2,
        ),
      );
      if (failed) process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      process.exitCode = 1;
    }
  }
}
