import 'dotenv/config';
import { runGeminiAvailabilityDiagnostic } from '../server/geminiDiagnostic.ts';

async function main() {
  if (!process.env.GEMINI_API_KEY?.trim()) {
    console.error('GEMINI_API_KEY is not set in the current environment.');
    process.exit(1);
  }

  const cliModels = process.argv.slice(2).filter((arg) => !arg.startsWith('-')).slice(0, 4);
  const report = await runGeminiAvailabilityDiagnostic({
    requestedModels: cliModels.length > 0 ? cliModels : undefined,
  });

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('Diagnostic failed:', err instanceof Error ? err.message : 'Unknown error');
  process.exit(1);
});
