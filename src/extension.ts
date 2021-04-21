import * as vscode from "vscode";

import {
    newGHCiTerminal,
    GHCiCodeLensProvider, sendGHCiSourceToTerminal,
} from "./ghci";

export function activate(context: vscode.ExtensionContext) {

    context.subscriptions.push(vscode.commands.registerCommand(
        "ghci.NewGHCiTermSession", newGHCiTerminal));

    const codelensProvider = new GHCiCodeLensProvider();
    vscode.languages.registerCodeLensProvider({
        "language": "haskell"
    }, codelensProvider);

    context.subscriptions.push(vscode.commands.registerCommand(
        "ghci.SendToGHCiTermSession", sendGHCiSourceToTerminal));

}
