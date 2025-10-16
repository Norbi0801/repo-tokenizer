#!/usr/bin/env ts-node
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

interface SampleDefinition {
  name: string;
  files: Record<string, string>;
}

const SAMPLES: SampleDefinition[] = [
  {
    name: 'js-lib',
    files: {
      'package.json': JSON.stringify({ name: 'sample-lib', version: '0.1.0' }, null, 2),
      'src/index.js': `export function greet(name) {
  return \`Hello, \${name}!\`;
}

export function sum(a, b) {
  return a + b;
}
`,
      'README.md': '# Sample JS Library\n\nDemonstrates a minimal JavaScript project for tokenizer benchmarking.\n',
    },
  },
  {
    name: 'python-service',
    files: {
      'requirements.txt': 'fastapi==0.110.0\nuvicorn==0.27.1\n',
      'app/main.py': `from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get(\"/hello\")\ndef hello(name: str = \"world\"):\n    return {\"message\": f\"Hello, {name}!\"}\n`,
      'tests/test_app.py': `from app.main import hello\n\ndef test_hello():\n    assert hello(\"tester\") == {\"message\": \"Hello, tester!\"}\n`,
    },
  },
  {
    name: 'go-cli',
    files: {
      'go.mod': 'module example.com/cli\n\ngo 1.21\n',
      'cmd/root.go': `package cmd\n\nimport \"fmt\"\n\nfunc Execute() {\n  fmt.Println(\"Sample CLI executed\")\n}\n`,
      'main.go': `package main\n\nimport \"example.com/cli/cmd\"\n\nfunc main() {\n  cmd.Execute()\n}\n`,
    },
  },
];

async function createSample(root: string, sample: SampleDefinition) {
  const sampleRoot = join(root, sample.name);
  await rm(sampleRoot, { recursive: true, force: true });
  await Promise.all(
    Object.entries(sample.files).map(async ([relative, contents]) => {
      const filePath = join(sampleRoot, relative);
      await mkdir(resolve(filePath, '..'), { recursive: true });
      await writeFile(filePath, contents, 'utf8');
    }),
  );
}

async function main() {
  const targetRoot = resolve(process.argv[2] ?? 'data/samples');
  await mkdir(targetRoot, { recursive: true });
  await Promise.all(SAMPLES.map((sample) => createSample(targetRoot, sample)));
  process.stdout.write(`Generated ${SAMPLES.length} sample repositories under ${targetRoot}\n`);
}

main().catch((error) => {
  process.stderr.write(`Sample generation failed: ${(error as Error).message}\n`);
  process.exit(1);
});
