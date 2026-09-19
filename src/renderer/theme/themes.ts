export type ThemeUI = {
  bgApp: string; bgTopBar: string; bgExplorer: string; bgEditor: string;
  bgPreviewAI: string; bgCard: string; bgInput: string; border: string;
  bgSelected: string; bgActiveTab: string; accentAI: string;
  textPrimary: string; textSecondary: string; textMuted: string;
  bgSidebar: string; borderSubtle: string; btnPrimary: string; btnHover: string;
  logoViolet: string; codeBlue: string; codeGreen: string; codePurple: string;
  codeOrange: string; success: string;
};

export type ThemeMonacoTokens = {
  comment: string; keyword: string; string: string; number: string;
  function: string; type: string; tag: string; attributeName: string;
  attributeValue: string; delimiter: string; variable: string;
};

export type ThemeMonaco = {
  background: string; foreground: string; lineNumber: string;
  lineNumberActive: string; selection: string; lineHighlight: string;
  cursor: string; tokens: ThemeMonacoTokens;
};

export type ThemeTerminal = {
  background: string; foreground: string; cursor: string; selectionBackground: string;
  black: string; red: string; green: string; yellow: string; blue: string;
  magenta: string; cyan: string; white: string;
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string;
  brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string;
};

export type Theme = { id: string; name: string; isDark: boolean; ui: ThemeUI; monaco: ThemeMonaco; terminal: ThemeTerminal; };

export const DEFAULT_THEME_ID = 'fabrica-dark';

export const themes: Theme[] = [
  {
    id: 'fabrica-dark',
    name: 'Fabrica Dark',
    isDark: true,
    ui: {
      bgApp: '#080719', bgTopBar: '#100A24', bgExplorer: '#080719', bgEditor: '#080719',
      bgPreviewAI: '#0C0922', bgCard: '#12102D', bgInput: '#17133A', border: '#29204A',
      bgSelected: '#3B1D72', bgActiveTab: '#21144A', accentAI: '#A855F7',
      textPrimary: '#F4F1FF', textSecondary: '#A9A3C7', textMuted: '#77718F',
      bgSidebar: '#080719', borderSubtle: 'rgba(255, 255, 255, 0.06)',
      btnPrimary: '#7C3AED', btnHover: '#8B5CF6', logoViolet: '#8B5CF6',
      codeBlue: '#38BDF8', codeGreen: '#4ADE80', codePurple: '#C084FC',
      codeOrange: '#FB923C', success: '#22C55E',
    },
    monaco: {
      background: '#080719', foreground: '#F4F1FF', lineNumber: '#77718F',
      lineNumberActive: '#C084FC', selection: '#3B1D72', lineHighlight: '#0C0922',
      cursor: '#A855F7',
      tokens: {
        comment: '#77718F', keyword: '#C084FC', string: '#4ADE80', number: '#FB923C',
        function: '#38BDF8', type: '#C084FC', tag: '#C084FC', attributeName: '#F4F1FF',
        attributeValue: '#4ADE80', delimiter: '#A9A3C7', variable: '#F4F1FF',
      },
    },
    terminal: {
      background: '#0C0922', foreground: '#F4F1FF', cursor: '#A855F7', selectionBackground: '#3B1D72',
      black: '#12102D', red: '#F87171', green: '#4ADE80', yellow: '#FB923C',
      blue: '#38BDF8', magenta: '#C084FC', cyan: '#22D3EE', white: '#F4F1FF',
      brightBlack: '#77718F', brightRed: '#FCA5A5', brightGreen: '#86EFAC', brightYellow: '#FCD34D',
      brightBlue: '#7DD3FC', brightMagenta: '#D8B4FE', brightCyan: '#67E8F9', brightWhite: '#FFFFFF',
    },
  },
  {
    id: 'vampire',
    name: 'Vampire',
    isDark: true,
    ui: {
      bgApp: '#14101E', bgTopBar: '#1C1526', bgExplorer: '#1A1424', bgEditor: '#14101E',
      bgPreviewAI: '#1C1526', bgCard: '#1F1830', bgInput: '#1F1830', border: '#322640',
      bgSelected: 'rgba(168, 85, 247, 0.15)', bgActiveTab: '#14101E', accentAI: '#A855F7',
      textPrimary: '#EDE0E8', textSecondary: '#B79FB0', textMuted: '#6B5768',
      bgSidebar: '#1A1424', borderSubtle: 'rgba(255, 255, 255, 0.06)',
      btnPrimary: '#7C3AED', btnHover: '#8B5CF6', logoViolet: '#8B5CF6',
      codeBlue: '#C084FC', codeGreen: '#C74D4D', codePurple: '#FF5E5E',
      codeOrange: '#8FCB9B', success: '#22C55E',
    },
    monaco: {
      background: '#14101E', foreground: '#EDE0E8', lineNumber: '#4A3B52',
      lineNumberActive: '#EDE0E8', selection: '#3B1D3A', lineHighlight: '#1E1628',
      cursor: '#FF5E5E',
      tokens: {
        comment: '#6B5768', keyword: '#FF5E5E', string: '#C74D4D', number: '#8FCB9B',
        function: '#C084FC', type: '#E39BD6', tag: '#D64550', attributeName: '#B98B5E',
        attributeValue: '#C74D4D', delimiter: '#8A7A91', variable: '#EDE0E8',
      },
    },
    terminal: {
      background: '#14101E', foreground: '#F8F8F2', cursor: '#FF5E5E', selectionBackground: '#3B1D3A',
      black: '#1F1830', red: '#FF5E5E', green: '#8FCB9B', yellow: '#F7D08A',
      blue: '#8B6EE8', magenta: '#C77DFF', cyan: '#7EDCE2', white: '#F8F8F2',
      brightBlack: '#6B5768', brightRed: '#FF8585', brightGreen: '#A8DCB5', brightYellow: '#FADFAA',
      brightBlue: '#A896F0', brightMagenta: '#D9A3FF', brightCyan: '#9EE6EB', brightWhite: '#FFFFFF',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    isDark: true,
    ui: {
      bgApp: '#282A36', bgTopBar: '#21222C', bgExplorer: '#21222C', bgEditor: '#282A36',
      bgPreviewAI: '#21222C', bgCard: '#343746', bgInput: '#343746', border: '#44475A',
      bgSelected: 'rgba(189, 147, 249, 0.15)', bgActiveTab: '#282A36', accentAI: '#BD93F9',
      textPrimary: '#F8F8F2', textSecondary: '#C0C2CE', textMuted: '#6272A4',
      bgSidebar: '#21222C', borderSubtle: 'rgba(255, 255, 255, 0.06)',
      btnPrimary: '#7C3AED', btnHover: '#8B5CF6', logoViolet: '#8B5CF6',
      codeBlue: '#50FA7B', codeGreen: '#F1FA8C', codePurple: '#FF79C6',
      codeOrange: '#BD93F9', success: '#22C55E',
    },
    monaco: {
      background: '#282A36', foreground: '#F8F8F2', lineNumber: '#6272A4',
      lineNumberActive: '#F8F8F2', selection: '#44475A', lineHighlight: '#2C2E3D',
      cursor: '#F8F8F2',
      tokens: {
        comment: '#6272A4', keyword: '#FF79C6', string: '#F1FA8C', number: '#BD93F9',
        function: '#50FA7B', type: '#8BE9FD', tag: '#FF5555', attributeName: '#FFB86C',
        attributeValue: '#F1FA8C', delimiter: '#F8F8F2', variable: '#F8F8F2',
      },
    },
    terminal: {
      background: '#282A36', foreground: '#F8F8F2', cursor: '#F8F8F2', selectionBackground: '#44475A',
      black: '#21222C', red: '#FF5555', green: '#50FA7B', yellow: '#F1FA8C',
      blue: '#BD93F9', magenta: '#FF79C6', cyan: '#8BE9FD', white: '#F8F8F2',
      brightBlack: '#6272A4', brightRed: '#FF6E6E', brightGreen: '#69FF94', brightYellow: '#FFFFA5',
      brightBlue: '#D6ACFF', brightMagenta: '#FF92DF', brightCyan: '#A4FFFF', brightWhite: '#FFFFFF',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    isDark: true,
    ui: {
      bgApp: '#2E3440', bgTopBar: '#272C36', bgExplorer: '#272C36', bgEditor: '#2E3440',
      bgPreviewAI: '#272C36', bgCard: '#3B4252', bgInput: '#3B4252', border: '#434C5E',
      bgSelected: 'rgba(136, 192, 208, 0.15)', bgActiveTab: '#2E3440', accentAI: '#88C0D0',
      textPrimary: '#ECEFF4', textSecondary: '#D8DEE9', textMuted: '#4C566A',
      bgSidebar: '#272C36', borderSubtle: 'rgba(255, 255, 255, 0.06)',
      btnPrimary: '#7C3AED', btnHover: '#8B5CF6', logoViolet: '#8B5CF6',
      codeBlue: '#EBCB8B', codeGreen: '#A3BE8C', codePurple: '#81A1C1',
      codeOrange: '#B48EAD', success: '#22C55E',
    },
    monaco: {
      background: '#2E3440', foreground: '#D8DEE9', lineNumber: '#4C566A',
      lineNumberActive: '#D8DEE9', selection: '#434C5E', lineHighlight: '#3B4252',
      cursor: '#ECEFF4',
      tokens: {
        comment: '#4C566A', keyword: '#81A1C1', string: '#A3BE8C', number: '#B48EAD',
        function: '#EBCB8B', type: '#8FBCBB', tag: '#81A1C1', attributeName: '#8FBCBB',
        attributeValue: '#A3BE8C', delimiter: '#D8DEE9', variable: '#D8DEE9',
      },
    },
    terminal: {
      background: '#2E3440', foreground: '#D8DEE9', cursor: '#D8DEE9', selectionBackground: '#434C5E',
      black: '#3B4252', red: '#BF616A', green: '#A3BE8C', yellow: '#EBCB8B',
      blue: '#81A1C1', magenta: '#B48EAD', cyan: '#88C0D0', white: '#E5E9F0',
      brightBlack: '#4C566A', brightRed: '#BF616A', brightGreen: '#A3BE8C', brightYellow: '#EBCB8B',
      brightBlue: '#81A1C1', brightMagenta: '#B48EAD', brightCyan: '#8FBCBB', brightWhite: '#ECEFF4',
    },
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    isDark: true,
    ui: {
      bgApp: '#282C34', bgTopBar: '#21252B', bgExplorer: '#21252B', bgEditor: '#282C34',
      bgPreviewAI: '#21252B', bgCard: '#2C313A', bgInput: '#2C313A', border: '#3E4451',
      bgSelected: 'rgba(97, 175, 239, 0.15)', bgActiveTab: '#282C34', accentAI: '#61AFEF',
      textPrimary: '#ABB2BF', textSecondary: '#9DA5B4', textMuted: '#5C6370',
      bgSidebar: '#21252B', borderSubtle: 'rgba(255, 255, 255, 0.06)',
      btnPrimary: '#7C3AED', btnHover: '#8B5CF6', logoViolet: '#8B5CF6',
      codeBlue: '#61AFEF', codeGreen: '#98C379', codePurple: '#C678DD',
      codeOrange: '#D19A66', success: '#22C55E',
    },
    monaco: {
      background: '#282C34', foreground: '#ABB2BF', lineNumber: '#495162',
      lineNumberActive: '#ABB2BF', selection: '#3E4451', lineHighlight: '#2C313C',
      cursor: '#528BFF',
      tokens: {
        comment: '#5C6370', keyword: '#C678DD', string: '#98C379', number: '#D19A66',
        function: '#61AFEF', type: '#E5C07B', tag: '#E06C75', attributeName: '#D19A66',
        attributeValue: '#98C379', delimiter: '#ABB2BF', variable: '#E06C75',
      },
    },
    terminal: {
      background: '#282C34', foreground: '#ABB2BF', cursor: '#528BFF', selectionBackground: '#3E4451',
      black: '#282C34', red: '#E06C75', green: '#98C379', yellow: '#E5C07B',
      blue: '#61AFEF', magenta: '#C678DD', cyan: '#56B6C2', white: '#ABB2BF',
      brightBlack: '#5C6370', brightRed: '#E06C75', brightGreen: '#98C379', brightYellow: '#E5C07B',
      brightBlue: '#61AFEF', brightMagenta: '#C678DD', brightCyan: '#56B6C2', brightWhite: '#FFFFFF',
    },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    isDark: true,
    ui: {
      bgApp: '#1A1B26', bgTopBar: '#16161E', bgExplorer: '#16161E', bgEditor: '#1A1B26',
      bgPreviewAI: '#16161E', bgCard: '#1F2335', bgInput: '#1F2335', border: '#292E42',
      bgSelected: 'rgba(122, 162, 247, 0.15)', bgActiveTab: '#1A1B26', accentAI: '#7AA2F7',
      textPrimary: '#C0CAF5', textSecondary: '#9AA5CE', textMuted: '#565F89',
      bgSidebar: '#16161E', borderSubtle: 'rgba(255, 255, 255, 0.06)',
      btnPrimary: '#7C3AED', btnHover: '#8B5CF6', logoViolet: '#8B5CF6',
      codeBlue: '#7AA2F7', codeGreen: '#9ECE6A', codePurple: '#BB9AF7',
      codeOrange: '#FF9E64', success: '#22C55E',
    },
    monaco: {
      background: '#1A1B26', foreground: '#C0CAF5', lineNumber: '#3B4261',
      lineNumberActive: '#A9B1D6', selection: '#283457', lineHighlight: '#1F2335',
      cursor: '#C0CAF5',
      tokens: {
        comment: '#565F89', keyword: '#BB9AF7', string: '#9ECE6A', number: '#FF9E64',
        function: '#7AA2F7', type: '#2AC3DE', tag: '#F7768E', attributeName: '#73DACA',
        attributeValue: '#9ECE6A', delimiter: '#89DDFF', variable: '#C0CAF5',
      },
    },
    terminal: {
      background: '#1A1B26', foreground: '#C0CAF5', cursor: '#C0CAF5', selectionBackground: '#283457',
      black: '#15161E', red: '#F7768E', green: '#9ECE6A', yellow: '#E0AF68',
      blue: '#7AA2F7', magenta: '#BB9AF7', cyan: '#7DCFFF', white: '#A9B1D6',
      brightBlack: '#414868', brightRed: '#F7768E', brightGreen: '#9ECE6A', brightYellow: '#E0AF68',
      brightBlue: '#7AA2F7', brightMagenta: '#BB9AF7', brightCyan: '#7DCFFF', brightWhite: '#C0CAF5',
    },
  },
];
