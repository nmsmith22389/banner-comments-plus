import * as fs from 'fs';
import * as path from 'path';
import * as Code from 'vscode';
import * as Figlet from 'figlet';
import * as CommentJson from 'comment-json';

type CommandParams = Parameters<typeof Code['commands']['registerCommand']>;

type CommentStyle = 'block' | 'line' | 'both';

interface Settings {
    font?: string;
    horizontalLayout?: Figlet.KerningMethods;
    verticalLayout?: Figlet.KerningMethods;
    trimTrailingWhitespace?: boolean;
    trimEmptyLines?: boolean;
    prefix?: string;
    suffix?: string;
    perLinePrefix?: string;
    commentStyle?: CommentStyle;
    commentConfig?: Code.CommentRule;
    languageId?: string;
    configs?: Record<string, Omit<Settings, 'configs'>>;
}

interface Config {
    figletConfig: {
        font: Settings['font'];
        horizontalLayout: Settings['horizontalLayout'];
        verticalLayout: Settings['verticalLayout'];
    };
    options: {
        trimTrailingWhitespace: Settings['trimTrailingWhitespace'];
        trimEmptyLines: Settings['trimEmptyLines'];
        prefix: Settings['prefix'];
        suffix: Settings['suffix'];
        perLinePrefix: Settings['perLinePrefix'];
        commentStyle: Settings['commentStyle'];
    };
    commentConfig?: Settings['commentConfig'];
}

export default class BannerComments {
    /**
     * String for accessing settings in getConfiguration
     */
    static configNamespace = 'banner-comments-plus';
    static fontsDir?: string;
    static addedFonts: string[] = [];
    static userAddedFonts: string[] = [];
    static oldFontsSync = Figlet.fontsSync;
    static oldLoadFontSync = Figlet.loadFontSync;

    static commands: CommandParams[] = [
        /* eslint-disable @typescript-eslint/unbound-method */
        ['banner-comments-plus.Apply', BannerComments.apply],
        ['banner-comments-plus.ApplyFromList', BannerComments.applyFromList],
        ['banner-comments-plus.ApplyFromFavorites', BannerComments.applyFavorite],
        ['banner-comments-plus.ApplyFromConfig', BannerComments.applyFromConfig],
        ['banner-comments-plus.SetDefaultFont', BannerComments.setDefaultFont],
        [
            'banner-comments-plus.SetDefaultFontFromFavorites',
            BannerComments.setDefaultFontFromFavorites,
        ],
        ['banner-comments-plus.AddFontToFavorites', BannerComments.addFontToFavorites],
        [
            'banner-comments-plus.AddCurrentFontToFavorites',
            BannerComments.addCurrentFontToFavorites,
        ],
        ['banner-comments-plus.RemoveFontFromFavorites', BannerComments.removeFromFavorites],
        ['banner-comments-plus.AddCustomFont', BannerComments.addCustomFont],
        ['banner-comments-plus.RemoveCustomFont', BannerComments.removeCustomFont],
        ['banner-comments-plus.AddNewConfig', BannerComments.addNewConfig],
        /* eslint-enable @typescript-eslint/unbound-method */
    ];

    //& API
    //& ---------------

    /**
     * Apply using defaults in settings
     */
    static apply(): void {
        const editor = Code.window.activeTextEditor;

        if (editor !== undefined) {
            const config = BannerComments.getDefaultConfig(editor.document.languageId);

            void BannerComments.applyToEditor(editor, config);
        }
    }

    /**
     * Apply default config after picking font from full list
     */
    static async applyFromList(): Promise<void> {
        const selectedPickerItem = await Code.window.showQuickPick(
            BannerComments.quickPickFontList()
        );
        const editor = Code.window.activeTextEditor;

        if (selectedPickerItem !== undefined && editor !== undefined) {
            const config = BannerComments.getDefaultConfig(editor.document.languageId);

            config.figletConfig.font = selectedPickerItem.label;

            void BannerComments.applyToEditor(editor, config);
        }
    }

    /**
     * Apply after picking font from favorites
     */
    static async applyFavorite(): Promise<void> {
        const selectedPickerItem = await Code.window.showQuickPick(
            BannerComments.quickPickFavoritesList()
        );
        const editor = Code.window.activeTextEditor;

        if (selectedPickerItem !== undefined && editor !== undefined) {
            const config = BannerComments.getDefaultConfig(editor.document.languageId);

            config.figletConfig.font = selectedPickerItem.label;

            void BannerComments.applyToEditor(editor, config);
        }
    }

    /**
     * Apply after picking config from settings or apply using shortcut with
     * `geddski.macros`.
     */
    static async applyFromConfig(name: string): Promise<void> {
        const editor = Code.window.activeTextEditor;
        const bcpConfig = Code.workspace.getConfiguration(BannerComments.configNamespace);
        const configs = bcpConfig.get<Settings['configs']>('configs');

        if (name) {
            const config = configs?.[name];

            if (config !== undefined && editor !== undefined) {
                config.languageId = editor.document.languageId;

                void BannerComments.applyToEditor(
                    editor,
                    BannerComments.formatConfigFromSettings(config)
                );
            } else {
                void Code.window.showInformationMessage(
                    "BannerComments+: no config found with name '" + name + "'"
                );
            }

            return;
        }

        const descriptionKeys = bcpConfig.get<string[]>('configDescriptionKeys');
        const items: Code.QuickPickItem[] = [];

        for (const key in configs) {
            const curConfig: any = configs[key];
            let description = 'font:' + (configs[key].font ?? 'N/A');

            if (!!descriptionKeys && descriptionKeys.length) {
                description = '';

                for (const decsKey of descriptionKeys) {
                    description +=
                        decsKey + ': ' + (curConfig as Record<string, string>)[decsKey] + ' | ';
                }
            }

            items.push({ label: key, description: description });
        }

        const selectedPickerItem = await Code.window.showQuickPick(items);

        if (selectedPickerItem !== undefined && editor !== undefined && configs !== undefined) {
            const config = configs[selectedPickerItem.label];

            config.languageId = editor.document.languageId;

            void BannerComments.applyToEditor(
                editor,
                BannerComments.formatConfigFromSettings(config)
            );
        }
    }

    /**
     * Change default font
     */
    static async setDefaultFont(): Promise<void> {
        const selectedPickerItem = await Code.window.showQuickPick(
            BannerComments.quickPickFontList()
        );

        if (!selectedPickerItem) return;

        const bcpConfig = Code.workspace.getConfiguration(BannerComments.configNamespace);

        void bcpConfig.update('font', selectedPickerItem.label, true);
    }

    /**
     * Change default font picking from favorites list
     */
    static async setDefaultFontFromFavorites(): Promise<void> {
        const selectedPickerItem = await Code.window.showQuickPick(
            BannerComments.quickPickFavoritesList()
        );

        if (!selectedPickerItem) return;

        const fontToSetName: string = selectedPickerItem.label;

        void Code.workspace
            .getConfiguration(BannerComments.configNamespace)
            .update('font', fontToSetName, true);
    }

    /**
     * Add a font to favorites list.
     */
    static async addFontToFavorites(): Promise<void> {
        const selectedPickerItem = await Code.window.showQuickPick(
            BannerComments.quickPickFontList()
        );

        if (!selectedPickerItem) return;

        const bcpConfig = Code.workspace.getConfiguration(BannerComments.configNamespace);
        const favoriteFonts = bcpConfig.get<string[]>('favorites');
        const fontToAddName = selectedPickerItem.label;

        if (!favoriteFonts?.includes(fontToAddName)) {
            favoriteFonts?.push(fontToAddName);
            void bcpConfig.update('favorites', favoriteFonts, true);
        } else {
            void Code.window.showInformationMessage(
                "BetterComments+: Chosen font '" + fontToAddName + "' already in favorites."
            );
        }
    }

    /**
     * Add current default font to favorites list.
     */
    static addCurrentFontToFavorites(): void {
        const bcpConfig = Code.workspace.getConfiguration(BannerComments.configNamespace);
        const currentFont = bcpConfig.get<string>('font');
        const favoriteFonts = bcpConfig.get<string[]>('favorites') ?? [];

        if (currentFont !== undefined && !favoriteFonts.includes(currentFont)) {
            favoriteFonts.push(currentFont);
            void bcpConfig.update('favorites', favoriteFonts, true);
        } else {
            void Code.window.showInformationMessage(
                "BetterComments+: Current font '" +
                    (currentFont ?? '') +
                    "' is already in favorites."
            );
        }
    }

    /**
     * Removed font from favorites list.
     */
    static async removeFromFavorites(): Promise<void> {
        const bcpConfig = Code.workspace.getConfiguration(BannerComments.configNamespace);
        const favoriteFonts = bcpConfig.get<string[]>('favorites') ?? [];

        if (!favoriteFonts.length) {
            void Code.window.showInformationMessage('BannerComments+: No fonts in favorites list');
            return;
        }

        const selectedPickerItem = await Code.window.showQuickPick(
            BannerComments.quickPickFavoritesList()
        );

        if (!selectedPickerItem) return;

        const fontToRemoveName = selectedPickerItem.label;
        const fontToRemoveIndex = favoriteFonts.indexOf(fontToRemoveName);

        favoriteFonts.splice(fontToRemoveIndex, 1);

        void bcpConfig.update('favorites', favoriteFonts, true);
    }

    /**
     * Add font to custom list.
     */
    static async addCustomFont(): Promise<void> {
        const opts: Code.InputBoxOptions = { placeHolder: 'file path to .flf font' };
        let pathInput = await Code.window.showInputBox(opts);

        if (!pathInput || !pathInput.length) return;

        // check if path actually leads to .flf
        if (!pathInput.indexOf('.flf')) {
            void Code.window.showErrorMessage(
                "BannerComments+: Provided file path does not contain '.flf'"
            );
            return;
        }

        if (pathInput[0] === '~') {
            pathInput = path.join(process.env.HOME ?? '', pathInput.slice(1));
        }

        if (!fs.existsSync(pathInput)) {
            void Code.window.showErrorMessage(
                'BannerComments+: Given file does not exist' + pathInput
            );
            return;
        } else {
            // add font to config
            const bcpConfig = Code.workspace.getConfiguration(BannerComments.configNamespace);
            const customFonts = bcpConfig.get<string[]>('customFonts') ?? [];

            if (customFonts.includes(pathInput)) {
                void Code.window.showInformationMessage(
                    'BannerComments+: Custom font already exists'
                );
                return;
            }

            customFonts.push(pathInput);

            await bcpConfig.update('customFonts', customFonts, true);

            // load font into figlet
            BannerComments.loadCustomFonts();
        }
    }
    /**
     * Remove font from custom list.
     */
    static async removeCustomFont(): Promise<void> {
        const bcpConfig = Code.workspace.getConfiguration(BannerComments.configNamespace);
        const customFonts = bcpConfig.get<string[]>('customFonts') ?? [];

        if (!customFonts.length) {
            void Code.window.showInformationMessage('BannerComments+: No custom fonts saved');
            return;
        }

        const selectedPickerItem = await Code.window.showQuickPick(
            BannerComments.quickPickCustomList()
        );

        if (!selectedPickerItem) return;

        const fontToRemoveName = selectedPickerItem.label;
        const fontToRemoveIndex = customFonts.indexOf(fontToRemoveName);

        customFonts.splice(fontToRemoveIndex, 1);

        void bcpConfig.update('customFonts', customFonts, true);
    }
    static addNewConfig(): void {
        void BannerComments.generateNewConfig();
    }

    //& LOGIC
    //& ---------------

    /**
     * Given an editor and config, make a banner!
     */
    // FIXME: type config param
    static applyToEditor(editor: Code.TextEditor, config: Config): Thenable<boolean> {
        return editor.edit((builder) => {
            editor.selections.forEach((selection) =>
                BannerComments.applyToDocumentSelection(editor.document, builder, selection, config)
            );
        });
    }

    /**
     * Replace selection or line using config.
     */
    static applyToDocumentSelection(
        document: Code.TextDocument,
        builder: Code.TextEditorEdit,
        selection: Code.Selection,
        config: Config
    ): void {
        let text: string;
        let selectionIsLine: Code.TextLine | undefined;

        if (selection.active.character === selection.anchor.character) {
            selectionIsLine = document.lineAt(selection.active);
            text = document.getText(selectionIsLine.range);
        } else {
            text = document.getText(selection);
        }

        const bannerText = BannerComments.generateBannerComment(text, config) ?? '';

        if (selectionIsLine) {
            builder.delete(selectionIsLine.range);
            builder.insert(selectionIsLine.range.start, bannerText);
        } else {
            builder.replace(selection, bannerText);
        }
    }

    /**
     * Generate the banner text given the configs.
     */
    static generateBannerComment(inputText: string, config: Config): string | undefined {
        let err: Error | undefined;
        let bannerText = '';
        const commentConfig = config.commentConfig;
        const options = config.options;

        try {
            let useBlockComment = false;
            let useLineComment = false;
            let linePrefix = '';

            if (commentConfig) {
                switch (options.commentStyle) {
                    case 'block': //? place blockComment around whole thing ONLY but if not block, use line
                        if (commentConfig.blockComment) useBlockComment = true;
                        else if (commentConfig.lineComment) useLineComment = true;
                        break;
                    case 'line': //? only use lineComment on each line but if no line, use block
                        if (commentConfig.lineComment) useLineComment = true;
                        else if (commentConfig.blockComment) useBlockComment = true;
                        break;
                    case 'both': //? place both styles
                        useBlockComment = !!commentConfig.blockComment;
                        useLineComment = !!commentConfig.lineComment;
                        break;
                }
            }

            if (useLineComment && commentConfig?.lineComment !== undefined) {
                linePrefix += commentConfig.lineComment;
            }

            linePrefix += options.perLinePrefix ?? '';

            // proccess now
            if (useBlockComment && commentConfig?.blockComment) {
                bannerText += commentConfig.blockComment[0] + '\n';
            }

            let figletText = '';

            figletText += (options.prefix ?? '') + '\n';
            figletText += Figlet.textSync(inputText, config.figletConfig as Figlet.Options);
            figletText += '\n' + (options.suffix ?? '');

            for (let _line of figletText.split('\n')) {
                if (options.trimEmptyLines && _line.replace(/^\s*$/, '').length == 0) continue;

                if (options.trimTrailingWhitespace) _line = _line.replace(/\s*$/, '');

                bannerText += linePrefix + _line + '\n';
            }

            if (useBlockComment && commentConfig?.blockComment) {
                bannerText += commentConfig.blockComment[1];
            }
        } catch (replaceErr) {
            err = replaceErr as Error;
        }

        // NOTE: Had to move this outside of the `finally` block.
        if (err) {
            void Code.window.showErrorMessage(err.message);
        } else {
            return bannerText;
        }
    }

    /*
     *  ██    ██ ████████ ██ ██      ███████
     *  ██    ██    ██    ██ ██      ██
     *  ██    ██    ██    ██ ██      ███████
     *  ██    ██    ██    ██ ██           ██
     *   ██████     ██    ██ ███████ ███████
     */
    static formatConfigFromSettings(config: Settings): Config {
        const bcpConfig = Code.workspace.getConfiguration(BannerComments.configNamespace);

        return {
            figletConfig: {
                font: config.font ?? bcpConfig.get('font'),
                horizontalLayout: config.horizontalLayout ?? bcpConfig.get('horizontalLayout'),
                verticalLayout: config.verticalLayout ?? bcpConfig.get('verticalLayout'),
            },
            options: {
                trimTrailingWhitespace:
                    config.trimTrailingWhitespace ?? bcpConfig.get('trimTrailingWhitespace'),
                trimEmptyLines: config.trimEmptyLines ?? bcpConfig.get('trimEmptyLines'),
                prefix: config.prefix ?? bcpConfig.get('prefix'),
                suffix: config.suffix ?? bcpConfig.get('suffix'),
                perLinePrefix: config.perLinePrefix ?? bcpConfig.get('perLinePrefix'),
                commentStyle: config.commentStyle ?? bcpConfig.get('commentStyle'),
            },
            commentConfig: config.languageId
                ? BannerComments.getCommentConfig(config.languageId)
                : undefined,
        } as Config;
    }

    static getDefaultConfig(languageId?: string): Config {
        const bcpConfig = Code.workspace.getConfiguration(BannerComments.configNamespace);

        return {
            figletConfig: {
                font: bcpConfig.get('font'),
                horizontalLayout: bcpConfig.get('horizontalLayout'),
                verticalLayout: bcpConfig.get('verticalLayout'),
            },
            options: {
                trimTrailingWhitespace: bcpConfig.get('trimTrailingWhitespace'),
                trimEmptyLines: bcpConfig.get('trimEmptyLines'),
                prefix: bcpConfig.get('prefix'),
                suffix: bcpConfig.get('suffix'),
                perLinePrefix: bcpConfig.get('perLinePrefix'),
                commentStyle: bcpConfig.get('commentStyle'),
            },
            commentConfig: BannerComments.getCommentConfig(languageId),
        } as Config;
    }

    static getCommentConfig(languageId?: string): Code.CommentRule | undefined {
        const langConfig = BannerComments.getLanguageConfig(languageId);

        if (!langConfig) {
            console.warn('BannerComments+: Language Config Not Found.');
        } else {
            if (Array.isArray(langConfig)) {
                for (const lang of langConfig) {
                    if (lang.comments) return lang.comments;
                }
            } else return langConfig.comments;
        }

        return undefined;
    }

    static getLanguageConfig(
        languageId?: string
    ): Code.LanguageConfiguration | Code.LanguageConfiguration[] | undefined {
        let langConfig: Code.LanguageConfiguration | undefined;
        const excludedLanguagesIds = ['plaintext'];

        if (languageId !== undefined && !excludedLanguagesIds.includes(languageId)) {
            let langConfigFilepath: string | undefined;
            const extsMatchingLang: string[] = [];

            for (const _ext of Code.extensions.all) {
                interface LanguageContribConfig {
                    id: string;
                    extensions: string[];
                    aliases: string[];
                    filenames: string[];
                    firstLine: string;
                    configuration: string;
                }
                interface PackageJSON {
                    contributes?: {
                        languages?: LanguageContribConfig[];
                    };
                }

                const packageJSON = _ext.packageJSON as PackageJSON;
                const languages = packageJSON.contributes?.languages;

                if (languages) {
                    const packageLangData = languages.find((lang) => lang.id === languageId);

                    if (packageLangData?.configuration) {
                        console.dir({
                            extensionPath: _ext.extensionPath,
                            langData: packageLangData.configuration,
                            join: path.join(
                                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                                _ext.extensionPath ?? '',
                                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                                packageLangData.configuration ?? ''
                            ),
                        });
                        langConfigFilepath = path.join(
                            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                            _ext.extensionPath ?? '',
                            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                            packageLangData.configuration ?? ''
                        );
                        extsMatchingLang.push(langConfigFilepath);
                    }
                }
            }

            // if many definitions
            if (extsMatchingLang.length > 1) {
                const langConfigs: Code.LanguageConfiguration[] = [];
                for (const lang of extsMatchingLang) {
                    if (!!lang && fs.existsSync(lang)) {
                        langConfigs.push(CommentJson.parse(fs.readFileSync(lang, 'utf8')));
                    }
                }
                return langConfigs;
            }
            // if only one definition
            if (!!langConfigFilepath && fs.existsSync(langConfigFilepath)) {
                /**
                 * unfortunatly, some of vscode's language config contains
                 * comments... ("xml" and "xsl" for example)
                 */
                langConfig = CommentJson.parse(
                    fs.readFileSync(langConfigFilepath, 'utf8')
                ) as Code.LanguageConfiguration;

                return langConfig;
            } else return undefined;
        }

        return undefined;
    }

    /*
// ███████ ██  ██████  ██      ███████ ████████     ██████  ██    ██ ██████  ███████
// ██      ██ ██       ██      ██         ██        ██   ██ ██    ██ ██   ██ ██
// █████   ██ ██   ███ ██      █████      ██        ██   ██ ██    ██ ██████  ███████
// ██      ██ ██    ██ ██      ██         ██        ██   ██ ██    ██ ██   ██      ██
// ██      ██  ██████  ███████ ███████    ██        ██████   ██████  ██████  ███████
*/
    static loadCustomFonts(): void {
        const fileExt = /\.flf$/;
        //? add fonts from user
        const customFonts = Code.workspace
            .getConfiguration(BannerComments.configNamespace)
            .get<string[]>('customFonts');

        customFonts?.forEach((font) => {
            const fontName = font.replace(fileExt, '');

            if (!BannerComments.userAddedFonts.includes(fontName)) {
                BannerComments.userAddedFonts.push(fontName);
            }
        });

        // add fonts from BCP
        if (BannerComments.fontsDir !== undefined) {
            fs.readdirSync(BannerComments.fontsDir).forEach(function (file) {
                if (fileExt.test(file)) {
                    const fontName = file.replace(fileExt, '');

                    if (!BannerComments.addedFonts.includes(fontName)) {
                        BannerComments.addedFonts.push(fontName);
                    }
                }
            });
        }
    }

    static bcpFontsSync(): Figlet.Fonts[] {
        return BannerComments.oldFontsSync().concat(
            BannerComments.addedFonts as Figlet.Fonts[],
            BannerComments.userAddedFonts as Figlet.Fonts[]
        );
    }

    static bcpLoadFontSync(name: string): Figlet.FontOptions {
        let fontName;

        if (BannerComments.addedFonts.includes(name)) {
            fontName = (BannerComments.fontsDir ?? '') + name + '.flf';
        }

        if (BannerComments.userAddedFonts.includes(name)) {
            fontName = name + '.flf';
        }

        if (fontName) {
            let fontData = fs.readFileSync(fontName, { encoding: 'utf-8' });

            fontData = fontData + '';

            return Figlet.parseFont(name, fontData);
        }

        return BannerComments.oldLoadFontSync(name as Figlet.Fonts);
    }

    /*
     *   ██████  ██    ██ ██  ██████ ██   ██ ██████  ██  ██████ ██   ██
     *  ██    ██ ██    ██ ██ ██      ██  ██  ██   ██ ██ ██      ██  ██
     *  ██    ██ ██    ██ ██ ██      █████   ██████  ██ ██      █████
     *  ██ ▄▄ ██ ██    ██ ██ ██      ██  ██  ██      ██ ██      ██  ██
     *   ██████   ██████  ██  ██████ ██   ██ ██      ██  ██████ ██   ██
     *      ▀▀
     */
    static quickPickFontList(): Code.QuickPickItem[] {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const availableFigletfonts = Figlet.fontsSync() ?? [];
        const items = availableFigletfonts.map((figletFont: string) => {
            return { label: figletFont, description: 'Use the ' + figletFont + ' font' };
        });

        return items;
    }

    static quickPickFavoritesList(): Code.QuickPickItem[] {
        const favoriteFonts = Code.workspace
            .getConfiguration(BannerComments.configNamespace)
            .get<string[]>('favorites');
        const items =
            favoriteFonts?.map((favoriteFont: string) => ({
                label: favoriteFont,
                description: 'Use the ' + favoriteFont + ' font',
            })) ?? [];

        return items;
    }

    static quickPickLayoutChoices(): Code.QuickPickItem[] {
        return [
            { label: 'default', description: '' },
            { label: 'full', description: '' },
            { label: 'fitted', description: '' },
            { label: 'controlled smushing', description: '' },
            { label: 'universal smushing', description: '' },
        ];
    }

    static quickPickCommentStyleChoices(): Code.QuickPickItem[] {
        return [
            { label: 'Block', description: 'prefer block style comments' },
            { label: 'Line', description: 'prefer line style comments' },
            { label: 'Both', description: 'always render both style comments' },
        ];
    }

    static quickPickBooleanChoices(): Code.QuickPickItem[] {
        return [
            { label: 'True', description: '' },
            { label: 'False', description: '' },
        ];
    }

    static quickPickCustomList(): Code.QuickPickItem[] {
        const customFonts = Code.workspace
            .getConfiguration(BannerComments.configNamespace)
            .get<string[]>('customFonts');
        const items =
            customFonts?.map((customFont: string) => {
                return { label: customFont, description: '' };
            }) ?? [];

        return items;
    }

    static addDefaultPick(otherList?: Code.QuickPickItem[]): Code.QuickPickItem[] {
        const def: Code.QuickPickItem[] = [{ label: 'Default Value', description: '' }];

        if (otherList) return def.concat(otherList);
        else return def;
    }

    static async generateNewConfig(): Promise<void> {
        const bcpConfig = Code.workspace.getConfiguration(BannerComments.configNamespace);
        const defaultConfig = BannerComments.getDefaultConfig();
        const configs = bcpConfig.get<Record<string, Settings>>('configs') ?? {};
        const config: Settings = {};
        let name = '';
        let saveDefaults = false;

        const input = await Code.window.showQuickPick(BannerComments.quickPickBooleanChoices(), {
            placeHolder: 'Store default values in config?',
        });

        //> saveDefaults
        saveDefaults = input?.label === 'True' ? true : false;

        //> name
        const nameInput = await Code.window.showInputBox({ prompt: 'Name for Config' });

        if (!nameInput?.length) {
            void Code.window.showErrorMessage('You must provide a name');
            return;
        }

        for (const key in configs) {
            if (key === nameInput) {
                void Code.window.showErrorMessage(
                    "Config with name '" + nameInput + "' already exists"
                );
                return;
            }
        }

        name = nameInput;

        //> font
        const fontInput = await Code.window.showQuickPick(
            BannerComments.addDefaultPick(BannerComments.quickPickFontList()),
            { placeHolder: 'font' }
        );

        if (fontInput?.label === 'Default Value') {
            if (saveDefaults) {
                config.font = defaultConfig.figletConfig.font;
            }
        } else config.font = fontInput?.label;

        //> horizontalLayout
        const hlInput = await Code.window.showQuickPick(
            BannerComments.addDefaultPick(BannerComments.quickPickLayoutChoices()),
            {
                placeHolder: 'horizontalLayout',
            }
        );

        if (hlInput?.label === 'Default Value') {
            if (saveDefaults) {
                config.horizontalLayout = defaultConfig.figletConfig.horizontalLayout;
            }
        } else {
            config.horizontalLayout = hlInput?.label as Settings['horizontalLayout'];
        }

        //> verticalLayout
        const vlInput = await Code.window.showQuickPick(
            BannerComments.addDefaultPick(BannerComments.quickPickLayoutChoices()),
            {
                placeHolder: 'verticalLayout',
            }
        );

        if (vlInput?.label === 'Default Value') {
            if (saveDefaults) {
                config.verticalLayout = defaultConfig.figletConfig.verticalLayout;
            }
        } else {
            config.verticalLayout = vlInput?.label as Settings['verticalLayout'];
        }

        //> trimTrailingWhitespace
        const trimWsInput = await Code.window.showQuickPick(
            BannerComments.addDefaultPick(BannerComments.quickPickBooleanChoices()),
            {
                placeHolder: 'trimTrailingWhitespace',
            }
        );

        if (trimWsInput?.label === 'Default Value') {
            if (saveDefaults) {
                config.trimTrailingWhitespace = defaultConfig.options.trimTrailingWhitespace;
            }
        } else {
            config.trimTrailingWhitespace = trimWsInput?.label === 'True' ? true : false;
        }

        //> trimEmptyLines
        const trimEmptyInput = await Code.window.showQuickPick(
            BannerComments.addDefaultPick(BannerComments.quickPickBooleanChoices()),
            { placeHolder: 'trimEmptyLines' }
        );

        if (trimEmptyInput?.label === 'Default Value') {
            if (saveDefaults) {
                config.trimEmptyLines = defaultConfig.options.trimEmptyLines;
            }
        } else {
            config.trimEmptyLines = trimEmptyInput?.label === 'True' ? true : false;
        }

        //> prefix
        const prefixInput = await Code.window.showInputBox({
            prompt: "Prefix - '' for empty, Esc for Default Value",
        });

        if (!prefixInput) {
            if (saveDefaults) {
                config.prefix = defaultConfig.options.prefix;
            }
        } else {
            if (prefixInput == "''") {
                config.prefix = '';
            } else config.prefix = prefixInput;
        }

        //> suffix
        const suffixInput = await Code.window.showInputBox({
            prompt: "Suffix - '' for empty, Esc for Default Value",
        });

        if (!suffixInput) {
            if (saveDefaults) {
                config.suffix = defaultConfig.options.suffix;
            }
        } else {
            if (suffixInput === "''") config.suffix = '';
            else config.suffix = suffixInput;
        }

        //> perLinePrefix
        const linePrefixInput = await Code.window.showInputBox({
            prompt: "perLinePrefix - '' for empty, Esc for Default Value",
        });

        if (!linePrefixInput) {
            if (saveDefaults) {
                config.perLinePrefix = defaultConfig.options.perLinePrefix;
            }
        } else {
            if (linePrefixInput === "''") config.perLinePrefix = '';
            else config.perLinePrefix = linePrefixInput;
        }

        //> commentStyle
        const commentStyleInput = await Code.window.showQuickPick(
            BannerComments.addDefaultPick(BannerComments.quickPickCommentStyleChoices()),
            {
                placeHolder: 'commentStyle',
            }
        );

        if (commentStyleInput?.label === 'Default Value') {
            if (saveDefaults) {
                config.commentStyle = defaultConfig.options.commentStyle;
            }
        } else {
            config.commentStyle = commentStyleInput?.label as Settings['commentStyle'];
        }

        //> finish and save
        configs[name] = config;

        void Code.workspace
            .getConfiguration(BannerComments.configNamespace)
            .update('configs', configs, true);
    }
}
