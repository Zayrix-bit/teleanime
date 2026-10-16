/**
 * THEMED TERMINAL COLOR LOGGER FOR TELEANIME
 * - AnimeTVPlus  -> Vibrant Orange (\x1b[38;5;208m / \x1b[1;38;5;208m)
 * - DesiDubAnime -> Vibrant Blue   (\x1b[38;5;39m / \x1b[1;38;5;39m)
 */

export const ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    
    // Vibrant Orange for AnimeTVPlus
    orange: '\x1b[38;5;208m',
    orangeBold: '\x1b[1;38;5;208m',
    orangeBg: '\x1b[48;5;208;30m',
    
    // Vibrant Sky Blue for DesiAnime
    blue: '\x1b[38;5;39m',
    blueBold: '\x1b[1;38;5;39m',
    blueBg: '\x1b[48;5;39;30m',
    
    green: '\x1b[32m',
    greenBold: '\x1b[1;32m',
    yellow: '\x1b[33m',
    yellowBold: '\x1b[1;33m',
    red: '\x1b[31m',
    redBold: '\x1b[1;31m',
    gray: '\x1b[90m'
};

/**
 * Returns text wrapped in ANSI colors based on provider.
 * @param {string} text 
 * @param {string} provider - 'AnimeTVPlus' or 'DesiDubAnime'
 * @param {boolean} bold 
 */
export function colorByProvider(text, provider, bold = false) {
    const prov = (provider || '').toLowerCase();
    if (prov.includes('animetv')) {
        return `${bold ? ANSI.orangeBold : ANSI.orange}${text}${ANSI.reset}`;
    }
    return `${bold ? ANSI.blueBold : ANSI.blue}${text}${ANSI.reset}`;
}

/**
 * Logs a message in Orange for AnimeTVPlus
 */
export function logAnimeTv(text) {
    console.log(`${ANSI.orange}${text}${ANSI.reset}`);
}

/**
 * Logs a bold message in Orange for AnimeTVPlus
 */
export function logAnimeTvBold(text) {
    console.log(`${ANSI.orangeBold}${text}${ANSI.reset}`);
}

/**
 * Logs a message in Blue for DesiAnime
 */
export function logDesiAnime(text) {
    console.log(`${ANSI.blue}${text}${ANSI.reset}`);
}

/**
 * Logs a bold message in Blue for DesiAnime
 */
export function logDesiAnimeBold(text) {
    console.log(`${ANSI.blueBold}${text}${ANSI.reset}`);
}

/**
 * Automatically logs a message in the color corresponding to provider
 */
export function logThemed(text, provider, bold = false) {
    console.log(colorByProvider(text, provider, bold));
}
