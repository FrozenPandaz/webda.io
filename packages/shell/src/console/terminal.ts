import { Terminal, WorkerOutput, WorkerLogLevel, WorkerMessage } from "@webda/workout";
import * as colors from "colors";

export class WebdaTerminal extends Terminal {
  versions;
  constructor(
    wo: WorkerOutput,
    versions,
    logo: string[] = undefined,
    level: WorkerLogLevel = undefined,
    format: string = undefined,
    tty: boolean = undefined
  ) {
    super(wo, level, format, tty);
    this.versions = versions;
    this.setTitle("Webda");
    logo =
      logo ||
      `[48;5;236m [48;5;61m                  [48;5;67m [48;5;178m                  [48;5;136m [48;5;237m [0m
[48;5;61m                   [48;5;208m                    [48;5;172m [0m
[48;5;61m                  [48;5;244m [48;5;208m                    [48;5;172m [0m
[48;5;61m                  [48;5;66m [48;5;208m   [48;5;172m [48;5;137m  [48;5;208m              [48;5;172m [0m
[48;5;61m                         [48;5;66m [48;5;208m             [48;5;172m [0m
[48;5;61m                         [48;5;244m [48;5;208m             [48;5;172m [0m
[48;5;61m                  [48;5;146m [48;5;231m      [48;5;255m [48;5;60m [48;5;172m [48;5;208m           [48;5;172m [0m
[48;5;61m                [48;5;104m [48;5;231m          [48;5;146m [48;5;137m [48;5;208m          [48;5;172m [0m
[48;5;61m           [48;5;231m                 [48;5;96m [48;5;208m          [48;5;172m [0m
[48;5;61m          [48;5;254m [48;5;231m                 [48;5;188m [48;5;60m [48;5;137m [48;5;208m        [48;5;172m [0m
[48;5;72m [48;5;107m      [48;5;67m [48;5;231m                       [48;5;255m [48;5;61m [48;5;255m [48;5;231m     [48;5;195m [0m
[48;5;108m [48;5;107m     [48;5;60m [48;5;231m                          [48;5;67m [48;5;231m     [48;5;255m [0m
[48;5;108m [48;5;107m     [48;5;66m [48;5;146m [48;5;231m                        [48;5;188m [48;5;146m [48;5;231m     [48;5;255m [0m
[48;5;108m [48;5;107m       [48;5;60m [48;5;146m [48;5;231m                     [48;5;103m [48;5;146m [48;5;231m      [48;5;255m [0m
[48;5;108m [48;5;107m          [48;5;65m     [48;5;239m    [48;5;65m     [48;5;237m [48;5;249m  [48;5;250m [48;5;252m [48;5;254m [48;5;231m        [48;5;255m [0m
[48;5;108m [48;5;107m                        [48;5;241m [48;5;231m             [48;5;255m [0m
[48;5;108m [48;5;107m                   [48;5;59m [48;5;108m [48;5;107m  [48;5;108m [48;5;243m [48;5;231m             [48;5;255m [0m
[48;5;108m [48;5;107m                  [48;5;242m [48;5;231m                   [48;5;255m [0m
[48;5;108m [48;5;107m                  [48;5;242m [48;5;231m                   [48;5;255m [0m
[48;5;72m [48;5;107m                  [48;5;240m [48;5;231m                   [48;5;146m [0m
    `.split("\n");
    if (Object.keys(versions).length) {
      let logoLength = Math.max(...logo.map(this.getTrueLength));
      logo.push("");
      for (let j in versions) {
        let version: string = <any>`${j} - v${this.versions[j].version}`.bold;
        version = version.padStart(version.length + (logoLength - version.length) / 2).padEnd(logoLength);
        logo.push(version);
      }
    }
    this.setLogo(logo);
  }

  handleTitleMessage(msg: WorkerMessage) {
    this.setTitle(msg.title);
  }

  setTitle(title: string = "") {
    this.title = this.webdaize(title);
  }

  getBar(size: number, complete: boolean) {
    if (complete) {
      return "[" + colors.bold(colors.yellow("\u2836".repeat(size)));
    } else {
      return " ".repeat(size) + "]";
    }
  }

  webdaize(str) {
    if (!this.tty) {
      return str;
    }
    return str.replace(/(web)(da)/gi, "$1" + "$2".yellow);
  }

  displayString(str: string, limit: number = undefined) {
    return this.webdaize(super.displayString(str, limit));
  }
}