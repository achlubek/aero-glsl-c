import { parseArgs } from "util";

import { Compiler } from "@app/Compiler";

const options: Record<string, { type: "string" }> = {
  dir: {
    type: "string",
  },
};
// eslint-disable-next-line
// @ts-ignore
const { values } = parseArgs({
  args: process.argv,
  options,
  allowPositionals: true,
});

const run = async (): Promise<void> => {
  if (values.dir && typeof values.dir === "string") {
    await new Compiler().compile(values.dir);
  }
};
void run();
