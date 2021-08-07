
import * as vscode from 'vscode';

import { TextDecoder } from 'util';

const GHCiTermPrefix = "GHCi - ";

function createGHCiTerminal(cmds: string[]): vscode.Terminal {
    const term = vscode.window.createTerminal(
        GHCiTermPrefix + cmds.join(' '),
        // Note: shellPath/shellArgs not supported by Theia yet,
        // this won't work on Eclipse Thiea
        "/usr/bin/env", cmds,
    );
    // for workaround: https://github.com/eclipse-theia/theia/issues/6574
    // term.sendText('/usr/bin/env ' + cmdl.concat(cmds).join(' '));
    term.show();
    return term;
}

function isGHCiTerminal(term: vscode.Terminal): boolean {
    if (term && undefined === term.exitStatus) {
        if (term.name.startsWith(GHCiTermPrefix)) {
            return true;
        }
    }
    return false;
}

export async function newGHCiTerminal(cmdl?: string): Promise<boolean> {
    function parseCmdLine(cmdl: string): string[] {
        // todo honor string quotes ?
        const cmds = cmdl.split(/\s+/).filter(arg => !!arg);
        return cmds;
    }

    if (undefined !== cmdl) {
        return null !== createGHCiTerminal(parseCmdLine(cmdl));
    }

    const wsCmdls: Array<string> = [];
    const wsCfgs = await vscode.workspace.findFiles('ghci.json');
    for (const cfgFile of wsCfgs) {
        const cfgUtf8 = await vscode.workspace.fs.readFile(cfgFile);
        const cfgJson = JSON.parse(new TextDecoder().decode(cfgUtf8));
        const cmdls = cfgJson['ghci.terminal.cmdl'];
        if (cmdls instanceof Array) {
            wsCmdls.push(...cmdls);
        } else if ('string' === typeof cmdls) {
            wsCmdls.push(cmdls);
        }
    }

    const defaultCmdl: Array<string> = wsCmdls.length < 1 ? ['ghci',] : parseCmdLine(wsCmdls[0]);
    const enteredCmd = new AsEnteredCmd('Run: ' + defaultCmdl.join(' '));
    const optCmds: (AsEnteredCmd | OptionCmd)[] = Array.from(wsCmdls,
        cmdl => new OptionCmd(cmdl, 'Run: ' + cmdl));
    optCmds.push(
        new OptionCmd("stack ghci", "Run with default target of stack"),
        new OptionCmd("cabal repl all", "Run with single target of cabal"),
        new OptionCmd("ghci", "Run bare GHCi"),
    );

    return await new Promise((resolve, reject) => {
        const qp = vscode.window.createQuickPick<AsEnteredCmd | OptionCmd>();
        qp.title = "New GHCi Terminal running command:";
        qp.placeholder = defaultCmdl.join(' ');
        qp.onDidChangeValue(e => {
            enteredCmd.label = e;
            enteredCmd.description = 'Run: ' + e;
            qp.items = ([enteredCmd] as (AsEnteredCmd | OptionCmd)[]).concat(optCmds);
        });
        qp.items = ([enteredCmd] as (AsEnteredCmd | OptionCmd)[]).concat(optCmds);
        qp.onDidAccept(() => {
            const sel = qp.selectedItems;
            try {
                if (sel.length > 0) {
                    const opt = sel[0];
                    const term = createGHCiTerminal(opt.label ? parseCmdLine(opt.label) : defaultCmdl);
                    resolve(null !== term);
                }
                resolve(false);
            } catch (exc) {
                reject(exc);
            } finally {
                qp.hide();
                qp.dispose();
            }
        });
        qp.show();
    });
}

class AsEnteredCmd implements vscode.QuickPickItem {

    alwaysShow = true

    label = ''
    description = ''

    constructor(description: string) {
        this.description = description;
    }

}

class OptionCmd implements vscode.QuickPickItem {

    alwaysShow = true

    label: string
    description?: string

    constructor(lable: string, description?: string) {
        this.label = lable;
        this.description = description;
    }

}


export class GHCiCodeLensProvider implements vscode.CodeLensProvider {

    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>()
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event

    constructor() {
        vscode.workspace.onDidChangeConfiguration((_) => {
            this._onDidChangeCodeLenses.fire();
        });
    }

    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken)
        : vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        let cellCnt = 0;
        const codeLenses = [];
        let beforeLineIdx = document.lineCount;
        let beforeBlockIdx = beforeLineIdx;
        for (let lineIdx = beforeLineIdx - 1; lineIdx >= 0; lineIdx--) {
            const line = document.lineAt(lineIdx);
            const effLine = line.text.trimStart();
            if (effLine.startsWith("-- %%")) {
                // a code cell
                codeLenses.push(new vscode.CodeLens(
                    new vscode.Range(lineIdx, 0, beforeLineIdx, 0), {
                    "title": "Run Cell",
                    "command": "ghci.SendToGHCiTermSession",
                    "arguments": [
                        document, lineIdx + 1, beforeLineIdx
                    ]
                }));
                if (lineIdx > 0) {
                    codeLenses.push(new vscode.CodeLens(
                        new vscode.Range(lineIdx, 0, lineIdx + 1, 0), {
                        "title": "Run Above",
                        "command": "ghci.SendToGHCiTermSession",
                        "arguments": [
                            document, 0, lineIdx
                        ]
                    }));
                    codeLenses.push(new vscode.CodeLens(
                        new vscode.Range(lineIdx, 0, lineIdx + 1, 0), {
                        "title": "Run Below",
                        "command": "ghci.SendToGHCiTermSession",
                        "arguments": [
                            document, lineIdx + 1, -1
                        ]
                    }));
                } else {
                    codeLenses.push(new vscode.CodeLens(
                        new vscode.Range(0, 0, 0, 0), {
                        "title": "Run All",
                        "command": "ghci.SendToGHCiTermSession",
                        "arguments": [
                            document, 0, -1
                        ]
                    }));
                }
                beforeLineIdx = lineIdx;
                cellCnt++;
            } else if (effLine.startsWith("-- %-")) {
                // a dummy cell, like comments
                beforeLineIdx = lineIdx;
                cellCnt++;
            } else if (effLine.startsWith("-- %{")) {
                // a block-starting cell
                codeLenses.push(new vscode.CodeLens(
                    new vscode.Range(lineIdx, 0, lineIdx + 1, 0), {
                    "title": "Run Block",
                    "command": "ghci.SendToGHCiTermSession",
                    "arguments": [
                        document, lineIdx, beforeBlockIdx
                    ]
                }));
                if (lineIdx > 0) {
                    codeLenses.push(new vscode.CodeLens(
                        new vscode.Range(lineIdx, 0, lineIdx + 1, 0), {
                        "title": "Run Above",
                        "command": "ghci.SendToGHCiTermSession",
                        "arguments": [
                            document, 0, lineIdx
                        ]
                    }));
                    codeLenses.push(new vscode.CodeLens(
                        new vscode.Range(lineIdx, 0, lineIdx + 1, 0), {
                        "title": "Run Below",
                        "command": "ghci.SendToGHCiTermSession",
                        "arguments": [
                            document, lineIdx + 1, -1
                        ]
                    }));
                } else {
                    codeLenses.push(new vscode.CodeLens(
                        new vscode.Range(0, 0, 0, 0), {
                        "title": "Run All",
                        "command": "ghci.SendToGHCiTermSession",
                        "arguments": [
                            document, 0, -1
                        ]
                    }));
                }
                beforeLineIdx = lineIdx;
                cellCnt++;
            } else if (effLine.startsWith("-- %}")) {
                // a block-ending cell
                beforeBlockIdx = lineIdx;
                codeLenses.push(new vscode.CodeLens(
                    new vscode.Range(lineIdx, 0, lineIdx + 1, 0), {
                    "title": "Run Rest",
                    "command": "ghci.SendToGHCiTermSession",
                    "arguments": [
                        document, beforeBlockIdx, -1
                    ]
                }));
                beforeLineIdx = lineIdx;
                cellCnt++;
            }
        }
        if (cellCnt > 0 && beforeLineIdx > 0) {
            codeLenses.push(new vscode.CodeLens(
                new vscode.Range(0, 0, beforeLineIdx, 0), {
                "title": "Run Cell",
                "command": "ghci.SendToGHCiTermSession",
                "arguments": [
                    document, 0, beforeLineIdx
                ]
            }));
            codeLenses.push(new vscode.CodeLens(
                new vscode.Range(0, 0, 0, 0), {
                "title": "Run All",
                "command": "ghci.SendToGHCiTermSession",
                "arguments": [
                    document, 0, -1
                ]
            }));
        }
        return codeLenses;
    }

}

export async function sendGHCiSourceToTerminal(document?: vscode.TextDocument,
    sinceLineIdx?: number, beforeLineIdx?: number): Promise<void> {

    let sourceText: null | string = null;
    if (!document || undefined === sinceLineIdx || undefined === beforeLineIdx) {
        document = vscode.window.activeTextEditor?.document;
        if (!document) {
            return;
        }
        const sel = vscode.window.activeTextEditor?.selection;
        const selText = sel ? document.getText(sel) : undefined;
        if (!sel || !selText) {
            sinceLineIdx = 0;
            beforeLineIdx = document.lineCount;
            sourceText = document.getText();
        } else {
            sinceLineIdx = sel.start.line;
            beforeLineIdx = sel.end.character > 0
                ? sel.end.line + 1
                : sel.end.line;
            sourceText = selText;
        }
    } else {
        if (beforeLineIdx < 0) {
            beforeLineIdx = document.lineCount;
        }
        sourceText = '';
        let inBlock = false;
        const ensureInDoBlock = () => {
            if (!inBlock) {
                sourceText += ':{\ndo\n';
                inBlock = true;
            }
        };
        const ensureInSeparateBlock = () => {
            if (inBlock) {
                sourceText += ':}\n';
            }
            sourceText += ':{\n';
            inBlock = true;

        };
        const ensureOutOfBlock = () => {
            if (inBlock) {
                sourceText += ':}\n';
                inBlock = false;
            }
        };
        for (let lineIdx = sinceLineIdx; lineIdx < beforeLineIdx; lineIdx++) {
            const line = document.lineAt(lineIdx);
            const lineText = line.text.trimLeft();
            if (line.isEmptyOrWhitespace) {
                sourceText += '\n';
            } else if (lineText.startsWith('-- %{')) {
                ensureInSeparateBlock();
                for (lineIdx++; lineIdx < beforeLineIdx; lineIdx++) {
                    const line = document.lineAt(lineIdx);
                    sourceText += line.text + '\n';
                }
            } else if (lineText.startsWith('-- %:')) {
                ensureOutOfBlock();
                sourceText += lineText.substr('-- %'.length) + '\n';
            } else if (startsWithAnyOf(
                "class", "type", "data", 'instance',
            )(line.text)) {
                ensureInSeparateBlock();
                sourceText += line.text + '\n';
            } else if (line.firstNonWhitespaceCharacterIndex <= 0) {
                sourceText += lineText + '\n';
            } else {
                ensureInDoBlock();
                sourceText += line.text + '\n';
            }
        }
        if (inBlock) {
            sourceText += ':}\n';
        }
    }

    if (null === sourceText || sourceText.length < 1) {
        console.warn('No GHCi source to send.');
        return;
    }

    const term = await prepareGHCiTerminal();
    if (null === term) {
        return; // cancelled
    }
    term.sendText(sourceText, true);
}

function startsWithAnyOf(...prefixes: string[]) {
    return function (s: string) {
        for (const prefix of prefixes) {
            if (s.startsWith(prefix)) return true;
        }
        return false;
    };
}

export async function prepareGHCiTerminal(): Promise<null | vscode.Terminal> {
    for (; ;) {
        let term = vscode.window.activeTerminal;
        if (term && isGHCiTerminal(term)) return term;
        for (term of vscode.window.terminals) {
            if (isGHCiTerminal(term)) return term;
        }
        if (! await newGHCiTerminal()) {
            return null; // cancelled
        }
    }
}
