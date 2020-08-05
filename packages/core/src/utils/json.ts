import { existsSync, readFileSync } from "fs";
import * as yaml from "yaml";

export const JSONUtils = {
  stringify: (value, replacer: (key: string, value: any) => any = undefined, space: number | string = 2) => {
    let stringified = [];
    return JSON.stringify(
      value,
      function (key: string, val: any): any {
        if ((stringified.indexOf(val) >= 0 && typeof val === "object") || key.startsWith("__")) {
          return undefined;
        }
        stringified.push(val);
        if (replacer) {
          return replacer.bind(this, key, val)();
        }
        return val;
      },
      space
    );
  },
  parse: value => {
    // Auto clean any noise
    return JSON.parse(value);
  },
  duplicate: value => {
    return JSON.parse(JSONUtils.stringify(value));
  },
  loadFile: filename => {
    if (!existsSync(filename)) {
      throw new Error("File does not exist");
    }
    let content = readFileSync(filename, "utf-8");
    if (filename.match(/\.ya?ml$/i)) {
      let res = yaml.parseAllDocuments(content);
      if (res.length === 1) {
        return res.pop().toJSON();
      }
      return res.map(d => d.toJSON());
    } else if (filename.match(/\.json$/i)) {
      return JSON.parse(content);
    }
    throw new Error("Unknown format");
  }
};
