"use strict";
import { Application, CancelablePromise, FileUtils, JSONUtils, Logger } from "@webda/core";
import { ChildProcess, spawn } from "child_process";
import * as colors from "colors";
import * as crypto from "crypto";
import * as fs from "fs";
import { Transform } from "stream";
import * as yargs from "yargs";
import { DeploymentManager } from "../handlers/deploymentmanager";
import { WebdaServer } from "../handlers/http";
import { WorkerOutput, WorkerLogLevel, ConsoleLogger, WorkerLogLevelEnum, LogFilter } from "@webda/workout";
import { WebdaTerminal } from "./terminal";
import * as path from "path";
import * as semver from "semver";
import { TypescriptSchemaResolver } from "../compiler";
import { Definition } from "typescript-json-schema";

export type WebdaCommand = (argv: any[]) => void;
export interface WebdaShellExtension {
  require: string;
  export?: string;
  description: string;
  terminal?: string;
  command?: string;
  yargs?: any;
  // Internal usage only
  relPath?: string;
}

export enum DebuggerStatus {
  Stopped = "STOPPED",
  Stopping = "STOPPING",
  Compiling = "COMPILING",
  Launching = "LAUNCHING",
  Serving = "SERVING"
}
export default class WebdaConsole {
  static webda: WebdaServer;
  static serverProcess: ChildProcess;
  static tscCompiler: ChildProcess;
  static logger: Logger;
  static terminal: WebdaTerminal;
  static app: Application;
  static debuggerStatus: DebuggerStatus = DebuggerStatus.Stopped;
  static onSIGINT: () => never = undefined;
  static extensions: { [key: string]: WebdaShellExtension } = {};

  static async parser(args): Promise<yargs.Argv> {
    let y = yargs()
      // @ts-ignore
      .exitProcess(false)
      .version(false) // Use our custom display of version
      .help(false) // Use our custom display of help
      .alias("d", "deployment")
      .alias("v", "version")
      .alias("h", "help")
      .option("log-level", {}) // No default to fallback on env or default of workout
      .option("log-format", {
        default: ConsoleLogger.defaultFormat
      })
      .option("no-compile", {
        type: "boolean"
      })
      .option("version", {
        type: "boolean"
      })
      .option("help", {
        type: "boolean"
      })
      .option("notty", {
        type: "boolean",
        default: false
      })
      .option("app-path", { default: process.cwd() });
    let cmds = WebdaConsole.builtinCommands();
    Object.keys(cmds).forEach(key => {
      let cmd = cmds[key];
      // Remove the first element as it is the handler
      y = y.command(cmd.command || key, cmd.description, cmd.module);
    });
    return y;
  }

  static serve(argv): CancelablePromise {
    return new CancelablePromise(
      async () => {
        if (argv.deployment) {
          // Loading first the configuration
          this.output("Serve as deployment: " + argv.deployment);
        } else {
          this.output("Serve as development");
        }
        WebdaConsole.webda = new WebdaServer(this.app);
        await this.webda.init();
        this.webda.setDevMode(argv.devMode);
        if (argv.devMode) {
          this.output("Dev mode activated : wildcard CORS enabled");
        }

        await this.webda.serve(argv.port, argv.websockets);
      },
      async () => {
        // Close server
        await this.webda.stop();
      }
    );
  }

  /**
   * Get a service configuration
   *
   * @param argv
   */
  static async serviceConfig(argv): Promise<number> {
    WebdaConsole.webda = new WebdaServer(this.app);
    let serviceName = argv.name;
    let service = this.webda.getService(serviceName);
    if (!service) {
      let error = "The service " + serviceName + " is missing";
      this.output(colors.red(error));
      return -1;
    }
    this.output(JSON.stringify(service.getParameters(), null, " "));
  }

  /**
   * Run a method of a service
   *
   * @param argv
   */
  static async worker(argv: yargs.Arguments) {
    let serviceName = <string>argv.serviceName;
    WebdaConsole.webda = new WebdaServer(this.app);
    await this.webda.init();
    let service = this.webda.getService(serviceName);
    let method = <string>argv.methodName || "work";
    if (!service) {
      this.log("ERROR", `The service ${serviceName} is missing`);
      return -1;
    }
    if (!service[method]) {
      this.log("ERROR", `The method ${method} is missing in service ${serviceName}`);
      return -1;
    }
    // Launch the worker with arguments
    let timestamp = new Date().getTime();

    return Promise.resolve(service[method](...(<string[]>argv.methodArguments)))
      .catch(err => {
        this.log("ERROR", "An error occured", err);
      })
      .then(res => {
        this.log(
          res !== undefined ? "INFO" : "DEBUG",
          res !== undefined ? (typeof res === "string" ? res : JSON.stringify(res, undefined, 2)) : "Result: void"
        );
        this.log("TRACE", "Took", Math.ceil((Date.now() - timestamp) / 1000) + "s");
      });
  }

  /**
   * Launch debug on application
   *
   * Compiling application as it is modified
   * Relaunching the serve command on any new modification
   *
   * @param argv
   */
  static async debug(argv: yargs.Arguments) {
    let launchServe = () => {
      if (this.serverProcess) {
        this.logger.logTitle("Refresh webda server");
        this.serverProcess.kill();
      } else {
        this.output("Launch webda serve in debug mode");
      }
      let args = ["--noCompile"];
      if (argv.deployment) {
        args.push("-d");
        args.push(<string>argv.deployment);
      }
      args.push("--appPath");
      args.push(this.app.getAppPath());

      if (argv.port) {
        args.push("--port");
        args.push(<string>argv.port);
      }

      if (argv.bind) {
        args.push("--bind");
        args.push(<string>argv.bind);
      }

      args.push("serve");
      if (argv.logLevels) {
        args.push("--logLevels");
        args.push(<string>argv.logLevels);
      }
      args.push("--logLevel");
      args.push("TRACE");
      args.push("--logFormat");
      args.push("#W# %(l)s|%(m)s");
      args.push("--notty");
      args.push("--devMode");
      let webdaConsole = this;
      let addTime = new Transform({
        transform(chunk, encoding, callback) {
          chunk
            .toString()
            .split("\n")
            .forEach(line => {
              // Stip tags
              line = line.replace(/\x1B\[(;?\d{1,3})+[mGK]/g, "");
              if (line.indexOf("Server running at") >= 0) {
                webdaConsole.setDebuggerStatus(DebuggerStatus.Serving);
                webdaConsole.logger.logTitle("Webda Debug " + line.substr(10));
                return;
              }
              let lvl: WorkerLogLevel = "INFO";
              if (line.startsWith("#W# ")) {
                lvl = line.substr(4, 9).trim();
                line = line.substr(10);
              }
              if (argv.logLevel) {
                // Should compare the loglevel
                if (!LogFilter(lvl, <any>argv.logLevel)) {
                  return;
                }
              }
              webdaConsole.output(line);
            });
          callback();
        }
      });
      this.serverProcess = spawn("webda", args);
      this.serverProcess.stdout.pipe(addTime);
      this.serverProcess.on("exit", () => {
        // Might want to auto restart
      });
    };
    // Typescript mode -> launch compiler and update after compile is finished
    fs.watch(this.app.getAppPath("webda.config.json"), launchServe);
    if (argv.deployment) {
      fs.watch(this.app.getAppPath(`deployments/${argv.deployment}.json`), launchServe);
    }

    /* istanbul ignore else */
    if (this.app.isTypescript()) {
      this.typescriptWatch(WebdaConsole.getTransform(launchServe));
    } else {
      /** deprecated */
      // Traditional js
      var listener = (event, filename) => {
        // Dont reload unless it is a true code changes
        // Limitation: It wont reload if resources are changed
        if (filename.endsWith(".js")) {
          launchServe();
        }
      };
      // glob files
      this.app.getPackagesLocations().forEach(packPath => {
        if (fs.existsSync(packPath) && fs.lstatSync(packPath).isDirectory()) {
          // Linux limitation, the recursive does not work
          fs.watch(
            packPath,
            <Object>{
              resursive: true
            },
            listener
          );
        }
      });
      launchServe();
    }
    return new CancelablePromise(() => {
      // Never return
    });
  }

  /**
   * Get stream transformer
   * @param launchServe
   */
  static getTransform(launchServe: () => void): Transform {
    let modification = -1;
    let webdaConsole = this;
    return new Transform({
      transform(chunk, encoding, callback) {
        let info = chunk.toString().trim();
        if (info.length < 4) {
          callback();
          return;
        }
        info.split("\n").forEach(line => {
          if (line.indexOf("TSFILE:") >= 0) {
            modification++;
            return;
          }
          if (line.substring(0, 8).match(/\d{1,2}:\d{2}:\d{2}/)) {
            // Might generate issue with some localization
            let offset = 2 - line.indexOf(":");
            // Simulate the colors , typescript compiler detect it is not on a tty
            if (line.match(/Found [1-9]\d* error/)) {
              webdaConsole.logger.log("ERROR", line.substring(14 - offset));
            } else {
              webdaConsole.output(line.substring(14 - offset));
              if (line.indexOf("Found 0 errors. Watching for file changes.") >= 0) {
                modification = 0;
                webdaConsole.setDebuggerStatus(DebuggerStatus.Launching);
                launchServe();
              }
            }
          } else {
            webdaConsole.output(line);
          }
        });
        callback();
      }
    });
  }

  /**
   * Get shell package version
   */
  static getVersion() {
    return JSON.parse(fs.readFileSync(__dirname + "/../../package.json").toString()).version;
  }

  /**
   * If deployment in argument: display or export the configuration
   * Otherwise launch the configuration UI
   *
   * @param argv
   */
  static async config(argv: yargs.Arguments): Promise<number> {
    if (argv.deployment) {
      let json = JSON.stringify(this.app.getConfiguration(<string>argv.deployment), null, " ");
      if (argv.exportFile) {
        fs.writeFileSync(<string>argv.exportFile, json);
      } else {
        this.output(json);
      }
    }
    return 0;
  }

  /**
   * If deployment in argument: display or export the configuration
   * Otherwise launch the configuration UI
   *
   * @param argv
   */
  static async migrateConfig(argv: yargs.Arguments): Promise<number> {
    let json = JSON.stringify(this.app.getConfiguration(), null, " ");

    if (argv.exportFile !== undefined) {
      fs.writeFileSync(this.app.getAppPath(<string>argv.exportFile), json);
    } else {
      fs.writeFileSync(this.app.getAppPath("webda.config.json"), json);
    }
    return 0;
  }

  /**
   * Deploy the new code
   * @param argv
   */
  static async deploy(argv: yargs.Arguments): Promise<number> {
    let manager = new DeploymentManager(this.app, <string>argv.deployment);
    argv._ = argv._.slice(1);
    return manager.commandLine(argv);
  }

  /**
   * Generate a new Webda Application based on yeoman
   *
   * @param argv
   * @param generatorName
   */
  static async init(argv: yargs.Arguments, generatorName: string = "webda") {
    if (argv.generator !== undefined) {
      generatorName = <string>argv.generator;
    }
    let generatorAction = "app";
    // Cannot start with :
    if (generatorName.indexOf(":") > 0) {
      [generatorName, generatorAction] = generatorName.split(":");
    }
    const yeoman = require("yeoman-environment");
    const env = yeoman.createEnv();
    env.register(require.resolve(`generator-${generatorName}/generators/${generatorAction}/index.js`), generatorName);
    return env.run(generatorName);
  }

  /**
   * Init loggers
   * @param argv
   */
  static async initLogger(argv: yargs.Arguments) {
    if (argv["logLevel"]) {
      process.env["LOG_LEVEL"] = <string>argv["logLevel"];
    }
  }

  /**
   * Main command switch
   *
   * Parse arguments
   * Init logger
   * Create Webda Application
   * Run the command or display help
   *
   * @param args
   */
  static async handleCommand(args, versions, output: WorkerOutput = undefined): Promise<number> {
    let res = await this.handleCommandInternal(args, versions, output);
    if (res !== 0 && this.terminal) {
      this.terminal.close();
    }
    return res;
  }

  static loadExtensions(appPath) {
    let getAppPath = function (re) {
      return path.join(appPath, re);
    };
    // Search for shell override
    if (fs.existsSync(getAppPath("node_modules"))) {
      let files = [];
      let rec = (p, lvl = 0) => {
        try {
          fs.readdirSync(p).forEach(f => {
            let ap = path.join(p, f);
            let stat = fs.lstatSync(ap);
            if (stat.isDirectory() || stat.isSymbolicLink()) {
              if (lvl < 3) {
                rec(ap, lvl + 1);
              }
            } else if (f === "webda.shell.json" && stat.isFile()) {
              this.log("DEBUG", "Found shell extension", ap);
              files.push(ap);
            }
          });
        } catch (err) {
          // skip exception
        }
      };
      rec(getAppPath("node_modules"));
      let appCustom = getAppPath("webda.shell.json");
      if (fs.existsSync(appCustom)) {
        files.push(appCustom);
      }
      // Load each files
      for (let i in files) {
        try {
          let info = JSON.parse(fs.readFileSync(files[i]).toString());
          for (let j in info.commands) {
            WebdaConsole.extensions[j] = info.commands[j];
            WebdaConsole.extensions[j].relPath = path.dirname(files[i]);
          }
        } catch (err) {
          this.log("ERROR", err);
          return -1;
        }
      }
    }
  }

  /**
   * Generate a JSON Schema for a symbol
   */
  static async schema(argv: yargs.Arguments) {
    argv._.shift();
    let symbol = <string>argv.type;
    let filename = <string>argv.exportFile;
    let resolver: TypescriptSchemaResolver = undefined;
    if (this.app.isTypescript()) {
      resolver = new TypescriptSchemaResolver(this.app, this.logger);
      this.app.setSchemaResolver(resolver);
    }
    let schema = this.app.getSchemaResolver().fromServiceType(symbol);
    if (!schema && resolver) {
      schema = resolver.fromSymbol(symbol);
    }
    if (filename) {
      FileUtils.save(schema, filename);
    } else {
      this.log("INFO", JSON.stringify(schema, undefined, 2));
    }
  }

  /**
   * Print a Fake Terminal to play with @webda/workout
   *
   * This is a non-supported method therefore no specific unit test
   * as there is no value in it
   */
  /* istanbul ignore next */
  static async fakeTerm() {
    let res;
    let i = 1;
    this.app.getWorkerOutput().startProgress("fake", 100, "Fake Progress");
    setInterval(() => {
      if (++i <= 100) {
        this.app.getWorkerOutput().updateProgress(i, "fake");
        if (i === 50) {
          this.app.getWorkerOutput().startProgress("fake2", 100, "Fake SubProgress");
        }
        if (i > 50) {
          this.app.getWorkerOutput().updateProgress((i - 50) * 2, "fake2");
        }
      } else if (i >= 200) {
        this.app.getWorkerOutput().startProgress("fake", 100, "Fake Progress");
        i = 0;
      }
      this.log(
        <any>WorkerLogLevelEnum[Math.floor(Math.random() * 5)],
        "Random level message".repeat(Math.floor(Math.random() * 10) + 1)
      );
    }, 100);
    while ((res = await this.app.getWorkerOutput().requestInput("Give me your number input", 0, ["\\d+"]))) {
      this.log("INFO", res);
    }
  }

  /**
   * Generate the webda.module.json
   */
  static generateModule() {
    if (this.app.isTypescript()) {
      this.app.setSchemaResolver(new TypescriptSchemaResolver(this.app, this.logger));
    }
    if (fs.existsSync(this.app.getAppPath("webda.config.json"))) {
      // Generate config schema as well
      this.generateConfigurationSchema();
    }
    return this.app.generateModule();
  }

  /**
   * Return the default builin command map
   */
  static builtinCommands(): {
    [name: string]: { command?: string; handler: Function; description: string; module?: any };
  } {
    return {
      serve: {
        handler: WebdaConsole.serve,
        description: "Serve the application",
        module: {
          devMode: {
            alias: "x"
          },
          port: {
            alias: "p",
            default: 18080
          },
          bind: {
            alias: "b",
            default: "127.0.0.1"
          },
          websockets: {
            alias: "w",
            default: false
          }
        }
      },
      deploy: {
        handler: WebdaConsole.deploy,
        description: "Deploy the application"
      },
      "new-deployment": {
        command: "new-deployment [name]",
        handler: DeploymentManager.newDeployment,
        description: "Create a new deployment for the application",
        module: y => {
          return y.command("name", "Deployment name to create");
        }
      },
      "service-configuration": {
        command: "service-configuration <name>",
        handler: WebdaConsole.serviceConfig,
        description: "Display the configuration of a service",
        module: y => {
          return y.command("name", "Service name to display configuration for");
        }
      },
      launch: {
        command: "launch <serviceName> [methodName] [methodArguments...]",
        handler: WebdaConsole.worker,
        description: "Launch a method of a service",
        module: y => {
          return y.command("serviceName", "Service name to launch");
        }
      },
      debug: {
        handler: WebdaConsole.debug,
        description: "Debug current application"
      },
      config: {
        handler: WebdaConsole.config,
        command: "config [exportFile]",
        description: "Generate the configuration of the application",
        module: y => {
          return y.command("exportFile", "File to export configuration to");
        }
      },
      "migrate-configuration": {
        handler: WebdaConsole.migrateConfig,
        command: "migrate-configuration [exportFile]",
        description: "Migrate and save the configuration",
        module: y => {
          return y.command("exportFile", "File to export configuration to", { default: "webda.config.json" });
        }
      },
      init: {
        command: "init [generator]",
        handler: WebdaConsole.init,
        description: "Initiate a new webda project using yeoman generator"
      },
      module: {
        handler: WebdaConsole.generateModule,
        description: "Generate the module for the application"
      },
      openapi: {
        command: "openapi [exportFile]",
        handler: WebdaConsole.generateOpenAPI,
        description: "Generate the OpenAPI definition for the app",
        module: {
          "include-hidden": {
            type: "boolean",
            default: false
          }
        }
      },
      schema: {
        command: "schema <type> [exportFile]",
        handler: WebdaConsole.schema,
        description: "Generate a schema for a type"
      },
      types: {
        handler: WebdaConsole.types,
        description: "List all available types for this project"
      },
      "configuration-schema": {
        command: "configuration-schema [configurationSchemaFile] [deploymentSchemaFile]",
        handler: WebdaConsole.configurationSchema,
        description: "Create the json schema that defines your webda.config.json",
        module: {
          full: {
            type: "boolean",
            default: false
          }
        }
      },
      faketerm: {
        handler: WebdaConsole.fakeTerm,
        description: "Launch a fake interactive terminal"
      },
      "generate-session-secret": {
        handler: WebdaConsole.generateSessionSecret,
        description: "Generate a new session secret"
      }
    };
  }

  /**
   * Generate the configuration schema
   *
   * @param filename to save for
   * @param full to keep all required
   */
  static generateConfigurationSchema(
    filename: string = ".webda-config-schema.json",
    deploymentFilename: string = ".webda-deployment-schema.json",
    full: boolean = false
  ) {
    if (this.app.isTypescript()) {
      let resolver = new TypescriptSchemaResolver(this.app, this.logger);
      this.app.setSchemaResolver(resolver);
      let res: Definition = resolver.generator.getSchemaForSymbol("Configuration");
      // Clean cached modules
      delete res.definitions.CachedModule;
      delete res.properties.cachedModules;
      // Add the definition for types
      res.definitions.ServicesType = {
        type: "string",
        enum: Object.keys(this.app.getServices())
      };
      res.properties.services = {
        type: "object",
        additionalProperties: {
          oneOf: []
        }
      };
      Object.keys(this.app.getServices()).forEach(serviceType => {
        const key = `ServiceType$${serviceType.replace(/\//g, "$")}`;
        const definition: Definition = (res.definitions[key] = <Definition>resolver.fromServiceType(serviceType));
        if (!definition) {
          return;
        }
        (<Definition>definition.properties.type).pattern = this.getServiceTypePattern(serviceType);
        (<Definition>(<Definition>res.properties.services).additionalProperties).oneOf.push({
          $ref: `#/definitions/${key}`
        });
        delete res.definitions[key]["$schema"];
        // Remove mandatory depending on option
        if (!full) {
          res.definitions[key]["required"] = ["type"];
        }
      });
      FileUtils.save(res, filename);
      // Build the deployment schema
      // Ensure builtin deployers are there
      DeploymentManager.addBuiltinDeployers(this.app);
      const definitions = JSONUtils.duplicate(res.definitions);
      res = {
        properties: {
          parameters: {
            type: "object",
            additionalProperties: true
          },
          resources: {
            type: "object",
            additionalProperties: true
          },
          services: {
            type: "object",
            additionalProperties: false,
            properties: {}
          },
          units: {
            type: "array",
            items: { oneOf: [] }
          }
        },
        definitions: res.definitions
      };
      const appServices = this.app.getConfiguration().services;
      Object.keys(appServices).forEach(k => {
        if (!appServices[k]) {
          return;
        }
        const key = `Service$${k}`;
        (<Definition>res.properties.services).properties[k] = {
          type: "object",
          oneOf: [
            { $ref: `#/definitions/${key}` },
            ...Object.keys(definitions)
              .filter(name => name.startsWith("ServiceType"))
              .map(dkey => ({ $ref: `#/definitions/${dkey}` }))
          ]
        };
      });
      Object.keys(this.app.getDeployers()).forEach(serviceType => {
        const key = `DeployerType$${serviceType.replace(/\//g, "$")}`;
        const definition: Definition = (res.definitions[key] = <Definition>resolver.fromServiceType(serviceType));
        if (!definition) {
          return;
        }
        if (!definition.properties) {
          definition.properties = {
            type: {
              type: "string"
            }
          };
        }
        (<Definition>definition.properties.type).pattern = this.getServiceTypePattern(serviceType);
        (<Definition>(<Definition>res.properties.units).items).oneOf.push({ $ref: `#/definitions/${key}` });
        delete definition["$schema"];
        // Remove mandatory depending on option
        if (!full) {
          definition["required"] = ["type"];
        }
      });
      FileUtils.save(res, deploymentFilename);
    }
  }

  /**
   * Generate a JSON Schema specific to the current configuration
   */
  static async configurationSchema(argv) {
    this.generateConfigurationSchema(argv.configurationSchemaFile, argv.deploymentSchemaFile, argv.full);
  }

  /**
   * Generate regex based on a service name
   *
   * The regex will ensure the pattern is not case sensitive and
   * that the namespace is optional
   *
   * @param type
   * @returns
   */
  static getServiceTypePattern(type: string): string {
    let result = "";
    type = this.app.completeNamespace(type).toLowerCase();
    for (let t of type) {
      if (t.match(/[a-z]/)) {
        result += `[${t}${t.toUpperCase()}]`;
      } else {
        result += t;
      }
    }
    // Namespace is optional
    let split = result.split("/");
    return `^(${split[0]}/)?${split[1]}$`;
    /**
     Should use this sample but it seems to not be handled by vscode
     let split = type.split("/");
     return `^(?i)(${split[0]}/)?${split[1]}$`;
     */
  }

  /**
   * Output all types of Deployers, Services and Models
   */
  static async types() {
    this.log("INFO", "Deployers:", Object.keys(this.app.getDeployers()).join(", "));
    this.log("INFO", "Services:", Object.keys(this.app.getServices()).join(", "));
    this.log("INFO", "Models:", Object.keys(this.app.getModels()).join(", "));
  }

  /**
   * Return if a package is within patch version of each others
   * @param package1
   * @param package2
   */
  static withinPatchVersion(package1: string, package2: string): boolean {
    return (
      semver.satisfies(package1.replace(/-.*/, ""), "~" + package2.replace(/-.*/, "")) ||
      semver.satisfies(package2.replace(/-.*/, ""), "~" + package1.replace(/-.*/, ""))
    );
  }

  static async handleCommandInternal(args, versions, output: WorkerOutput = undefined): Promise<number> {
    // Arguments parsing
    let parser = await this.parser(args);
    let argv: any = parser.parse(args);

    // Output version
    if (argv.version) {
      for (let v in versions) {
        console.log(WebdaTerminal.webdaize(`${v}: ${versions[v].version}`));
      }
      return 0;
    }

    let extension: WebdaShellExtension;
    await this.initLogger(argv);

    // Init WorkerOutput
    output = output || new WorkerOutput();
    WebdaConsole.logger = new Logger(output, "console/webda");

    // Only load extension if the command is unknown
    if (!WebdaConsole.builtinCommands()[argv._[0]] || argv.help) {
      WebdaConsole.loadExtensions(argv.appPath || process.cwd());
      Object.keys(this.extensions).forEach(cmd => {
        let ext = this.extensions[cmd];
        // Dynamic we load from the extension as it is more complex
        if (this.extensions[cmd].yargs === "dynamic") {
          parser = parser.command(
            ext.command || cmd,
            ext.description,
            require(path.join(ext.relPath, ext.require))["yargs"]
          );
          // Hybrid with builder
        } else if (ext.yargs && ext.yargs.command) {
          parser = parser.command(ext.yargs);
        } else {
          // Simple case
          parser = parser.command(ext.command || cmd, ext.description, this.extensions[cmd].yargs);
        }
      });
      argv = parser.parse(args);
      extension = this.extensions[argv._[0]];
    }

    if (argv.help || <string>argv._[0] === "help") {
      this.displayHelp(parser);
      return 0;
    }

    if (["deploy", "install", "uninstall"].indexOf(<string>argv._[0]) >= 0) {
      if (argv.deployment === undefined) {
        this.output("Need to specify an environment");
        return -1;
      }
    }

    let logger;
    if (argv.notty || !process.stdout.isTTY || ["init"].indexOf(<string>argv._[0]) >= 0) {
      logger = new ConsoleLogger(output, <WorkerLogLevel>argv.logLevel, <string>argv.logFormat);
    } else {
      if (extension && extension.terminal) {
        // Allow override of terminal
        this.terminal = new (require(path.join(extension.relPath, extension.terminal)).default)(
          output,
          versions,
          argv.logLevel,
          argv.logFormat
        );
      } else {
        this.terminal = new WebdaTerminal(
          output,
          versions,
          undefined,
          <WorkerLogLevel>argv.logLevel,
          <string>argv.logFormat
        );
      }
    }

    // Add SIGINT listener
    if (WebdaConsole.onSIGINT) {
      process.removeListener("SIGINT", WebdaConsole.onSIGINT);
    }
    WebdaConsole.onSIGINT = () => {
      output.log("INFO", "Exiting on SIGINT");
      WebdaConsole.stopDebugger();
      if (this.webda) {
        this.webda.stop();
      }
      if (this.terminal) {
        this.terminal.close();
      }
      process.exit(0);
    };
    process.on("SIGINT", WebdaConsole.onSIGINT);

    try {
      // Display warning for versions mismatch
      if (!this.withinPatchVersion(versions["@webda/core"].version, versions["@webda/shell"].version)) {
        output.log(
          "WARN",
          `Versions mismatch: @webda/core (${versions["@webda/core"].version}) and @webda/shell (${versions["@webda/shell"].version}) are not within patch versions`
        );
      }

      // Load Application
      try {
        this.app = new Application(<string>argv.appPath, output, true);
      } catch (err) {
        output.log("WARN", err.message);
      }

      // Update logo
      if (this.app && this.app.getPackageWebda().logo && this.terminal) {
        let logo = this.app.getPackageWebda().logo;
        this.log("TRACE", "Updating logo", logo);
        if (Array.isArray(logo)) {
          this.terminal.setLogo(logo);
        } else if (typeof logo === "string") {
          if (fs.existsSync(this.app.getAppPath(logo))) {
            this.terminal.setLogo(fs.readFileSync(this.app.getAppPath(logo)).toString().split("\n"));
          } else {
            this.log("WARN", "Cannot find logo", this.app.getAppPath(logo));
          }
        }
      }
      if (this.terminal && this.terminal.getLogo().length === 0) {
        this.terminal.setDefaultLogo();
      }

      // Load deployment
      if (argv.deployment) {
        if (!this.app.hasDeployment(<string>argv.deployment)) {
          this.output(`Unknown deployment: ${argv.deployment}`);
          return -1;
        }
        try {
          this.app.setCurrentDeployment(<string>argv.deployment);
          // Try to load it already
          this.app.getDeployment();
        } catch (err) {
          this.log("ERROR", err.message);
          return -1;
        }
      }

      // Recompile project
      if (argv.noCompile) {
        this.app.preventCompilation(true);
      }

      // Load webda module
      if (this.app) {
        this.app.loadModules();
      }

      // Launch builtin commands
      if (WebdaConsole.builtinCommands()[argv._[0]]) {
        await WebdaConsole.builtinCommands()[argv._[0]].handler.bind(this)(argv);
        return 0;
      }

      if (extension) {
        this.log("DEBUG", "Launching extension " + argv._[0], extension);
        // Load lib
        argv._.shift();
        // TODO Implement a second yargs parser for the extension
        return await this.executeShellExtension(extension, extension.relPath, argv);
      }
    } finally {
      if (this.terminal) {
        this.log("TRACE", "Closing terminal");
        this.terminal.close();
      }
      if (logger) {
        logger.close();
      }
    }
    // Display help if nothing is found
    this.displayHelp(parser);
  }

  /**
   * Display help for parser
   *
   * Separated into a method to allow override
   * @param parser
   */
  static displayHelp(parser) {
    parser.showHelp(s => process.stdout.write(WebdaTerminal.webdaize(s)));
  }

  /**
   *
   * @param ext extension to execute
   * @param relPath relative path of the extension
   * @param argv arguments passed to the shell
   */
  static async executeShellExtension(ext: WebdaShellExtension, relPath: string, argv: any) {
    ext.export ??= "default";
    const data = require(path.join(relPath, ext.require));
    return data[ext.export](this, argv);
  }

  /**
   * Generate a random string based on crypto random
   *
   * @param length of the string
   */
  static async generateRandomString(length = 256): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      crypto.randomBytes(length, (err, buffer) => {
        if (err) {
          return reject(err);
        }
        return resolve(buffer.toString("base64").substring(0, length));
      });
    });
  }

  /**
   * Generate a new sessionSecret for the application
   */
  static async generateSessionSecret() {
    let config = JSON.parse(fs.readFileSync(this.app.getAppPath("webda.config.json")).toString()) || {};
    config.parameters = config.parameters || {};
    config.parameters.sessionSecret = await this.generateRandomString(256);
    fs.writeFileSync(this.app.getAppPath("webda.config.json"), JSON.stringify(config, null, 2));
  }

  /**
   * Generate the OpenAPI definition in a file
   *
   * If filename can end with .yml or .json to select the format
   * @param argv
   */
  static async generateOpenAPI(argv: yargs.Arguments): Promise<void> {
    this.webda = new WebdaServer(this.app);
    let openapi = this.webda.exportOpenAPI(!argv.includeHidden);
    let name = <string>argv.exportFile || "./openapi.json";
    FileUtils.save(openapi, name);
  }

  /**
   * Launch tsc --watch and pass output to the stream
   * @param stream to get output from
   */
  static async typescriptWatch(stream: Transform) {
    this.output("Typescript compilation");
    this.tscCompiler = spawn("tsc", ["--watch", "-p", this.app.getAppPath(), "--listEmittedFiles"], {});
    this.tscCompiler.stdout.pipe(stream).pipe(process.stdout);
    return new Promise<void>(resolve => {
      this.tscCompiler.on("exit", code => {
        this.tscCompiler = undefined;
        this.setDebuggerStatus(DebuggerStatus.Stopped);
        if (!code) {
          resolve();
          return;
        }
        process.exit(code);
      });
    });
  }

  /**
   * Stop the debugger and wait for its complete stop
   */
  static async stopDebugger() {
    if (this.serverProcess) {
      this.serverProcess.kill();
    }
    if (this.tscCompiler) {
      this.setDebuggerStatus(DebuggerStatus.Stopping);
      this.tscCompiler.kill();
    }
    do {
      if (!this.tscCompiler) {
        this.setDebuggerStatus(DebuggerStatus.Stopped);
        return;
      }
      // Waiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (true);
  }

  /**
   * Get debugger current status
   */
  static getDebuggerStatus(): DebuggerStatus {
    return this.debuggerStatus;
  }

  static setDebuggerStatus(status: DebuggerStatus) {
    this.debuggerStatus = status;
  }

  static output(...args) {
    this.log("INFO", ...args);
  }

  static log(level: WorkerLogLevel, ...args) {
    WebdaConsole.logger.log(level, ...args);
  }
}

export { WebdaConsole };
