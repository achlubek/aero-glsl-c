import { exec } from "child_process";
import * as crypto from "crypto";
import { scan } from "fast-scan-dir-recursive";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

export class Compiler {
  private filesMap: Record<string, string>;

  public constructor() {
    this.filesMap = {};
  }

  private async scanDir(dir: string, tmp: string): Promise<string[]> {
    let files = await scan(dir);
    const fulltmp = path.resolve(tmp);
    files = files.filter((file) => !file.startsWith(fulltmp));
    for (const file of files) {
      this.filesMap[file] = file;
    }
    return files;
  }

  private md5(input: string): string {
    return crypto.createHash("md5").update(input).digest("hex");
  }

  private resolveIncludes(file: string): string {
    const contents = fs
      .readFileSync(file)
      .toString()
      .replaceAll("\r\n", "\n")
      .split("\n");
    if (!contents[0].startsWith("#version")) {
      contents.unshift(`#line 1 1`);
    }

    const header = "#include ";
    const guard = "#pragma once";
    let encloseInGuard = false;
    for (let i = 0; i < contents.length; i++) {
      if (contents[i].startsWith(header)) {
        const include = path.resolve(
          path.join(path.dirname(file), contents[i].substring(header.length))
        );
        if (!this.filesMap[include]) {
          // eslint-disable-next-line no-console
          console.error("ERROR: NOT FOUND: " + include);
          throw Error("ERROR: NOT FOUND: " + include);
        }
        contents[i] =
          this.resolveIncludes(this.filesMap[include]) +
          `\n#line ${i + (encloseInGuard ? 3 : 2)} 234`;
      } else if (contents[i].includes(guard)) {
        contents[i] = "";
        encloseInGuard = true;
      }
    }
    let result = contents.join("\n");
    if (encloseInGuard) {
      const guid = "X" + this.md5(file);
      result =
        "#ifndef " + guid + "\n#define " + guid + "\n" + result + "\n#endif";
    }
    return result;
  }

  private makeNamespacedName(dr: string, filepath: string): string {
    const relative = path.relative(dr, filepath);
    return relative.replaceAll("\\", ".").replaceAll("/", ".");
  }

  public async compile(dr: string): Promise<void> {
    dr = path.resolve(dr);

    ["tmp", "compiled"].map((dir) => {
      if (!fs.existsSync(path.join(dr, dir))) {
        fs.mkdirSync(path.join(dr, dir));
      } else {
        fs.rmSync(path.join(dr, dir), { recursive: true, force: true });
        fs.mkdirSync(path.join(dr, dir));
      }
    });

    const files = await this.scanDir(dr, path.join(dr, "tmp"));

    const collectedErrors: Record<string, string[]> = {};

    await Promise.all(
      files.map(async (file) => {
        //for (const file of files) {
        if (
          file.endsWith(".frag") ||
          file.endsWith(".vert") ||
          file.endsWith(".comp")
        ) {
          const dstfile = path.join(
            dr,
            "compiled/" + this.makeNamespacedName(dr, file) + ".spv"
          );

          const tmp = path.join(dr, "tmp/", this.makeNamespacedName(dr, file));

          const code = this.resolveIncludes(file);
          await promisify(fs.writeFile)(tmp, code);
          // eslint-disable-next-line no-console
          console.log(
            "Compiling " +
              path.relative(dr, file) +
              " to " +
              path.relative(dr, dstfile)
          );
          try {
            await promisify(exec)(
              `glslangValidator -V "${path.resolve(tmp)}" -o "${dstfile}"`,
              {
                cwd: dr,
              }
            );
          } catch (e) {
            // eslint-disable-next-line
            // @ts-ignore
            // eslint-disable-next-line
            for (const line: string of e.stdout.toString().split("\n")) {
              // eslint-disable-next-line
              // @ts-ignore
              // eslint-disable-next-line
              if (line.includes("ERROR")) {
                if (!(file in collectedErrors)) {
                  collectedErrors[file] = [];
                }
                // eslint-disable-next-line
                // @ts-ignore
                // eslint-disable-next-line
                collectedErrors[file].push(line);
                process.exitCode = 1;
              }
            }
          }
        }
      })
    );
    for (const file in collectedErrors) {
      const errors = collectedErrors[file];
      for (const error of errors) {
        // eslint-disable-next-line no-console
        console.error(`${file}: ${error}`);
      }
    }
  }
}
