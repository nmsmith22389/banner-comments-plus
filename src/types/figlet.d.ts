import * as figlet from 'figlet';

declare module 'figlet' {
    function parseFont(fontName: string, data: string): figlet.FontOptions;
}
