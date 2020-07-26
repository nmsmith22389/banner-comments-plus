/* eslint-disable import/prefer-default-export */
import * as Code from 'vscode';
import * as Figlet from 'figlet';
import BannerComments from './BannerComments';

// export function deactivate() {}

export function activate(context: Code.ExtensionContext): void {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-expect-error
    // eslint-disable-next-line @typescript-eslint/unbound-method
    Figlet.fontsSync = BannerComments.bcpFontsSync;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-expect-error
    // eslint-disable-next-line @typescript-eslint/unbound-method
    Figlet.loadFontSync = BannerComments.bcpLoadFontSync;

    context.subscriptions.push(
        ...BannerComments.commands.map((args) => Code.commands.registerCommand(...args))
    );

    BannerComments.fontsDir = context.extensionPath + '/fonts/';

    BannerComments.loadCustomFonts();
}
