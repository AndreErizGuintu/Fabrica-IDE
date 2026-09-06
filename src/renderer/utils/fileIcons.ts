// Shared file-type icon lookup used by the sidebar tree and the editor tab bar.
// Returns a full className string ready for <i className={...} />.
//  - Language files -> devicon (colored brand icons). The `colored` modifier
//    activates brand color on -plain/-line glyphs and is harmless on -original.
//  - Everything devicon has no icon for (folders, json, plain/data/config/image
//    files, unknown extensions) -> codicon fallback (needs its base `codicon` class).
export function getFileIcon(filename: string, isDirectory?: boolean): string {
  // devicon has no folder icon -> codicon
  if (isDirectory) return 'codicon codicon-folder';

  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  const icons: Record<string, string> = {
    // web / styles
    '.html': 'devicon-html5-plain colored',
    '.htm': 'devicon-html5-plain colored',
    '.css': 'devicon-css3-plain colored',
    '.scss': 'devicon-sass-original colored',
    '.sass': 'devicon-sass-original colored',
    '.less': 'codicon codicon-symbol-color', // no square devicon glyph (wordmark only)
    // js/ts
    '.js': 'devicon-javascript-plain colored',
    '.mjs': 'devicon-javascript-plain colored',
    '.cjs': 'devicon-javascript-plain colored',
    '.ts': 'devicon-typescript-plain colored',
    '.tsx': 'devicon-react-original colored',
    '.jsx': 'devicon-react-original colored',
    // languages
    '.py': 'devicon-python-plain colored',
    '.php': 'devicon-php-plain colored',
    '.java': 'devicon-java-plain colored',
    '.cs': 'devicon-csharp-plain colored',
    '.dart': 'devicon-dart-plain colored',
    '.go': 'devicon-go-plain colored',
    '.rb': 'devicon-ruby-plain colored',
    '.rs': 'devicon-rust-plain colored',
    '.kt': 'devicon-kotlin-plain colored',
    '.swift': 'devicon-swift-plain colored',
    '.c': 'devicon-c-plain colored',
    '.h': 'devicon-c-plain colored',
    '.cpp': 'devicon-cplusplus-plain colored',
    '.hpp': 'devicon-cplusplus-plain colored',
    '.vue': 'devicon-vuejs-plain colored',
    '.svelte': 'devicon-svelte-plain colored',
    '.md': 'devicon-markdown-original colored',
    // scripts / infra
    '.sh': 'devicon-bash-plain colored',
    '.bash': 'devicon-bash-plain colored',
    '.zsh': 'devicon-bash-plain colored',
    '.ps1': 'devicon-powershell-plain colored',
    '.dockerfile': 'devicon-docker-plain colored',
    '.dockerignore': 'devicon-docker-plain colored',
    '.tf': 'devicon-terraform-plain colored',
    '.tfvars': 'devicon-terraform-plain colored',
    '.gitignore': 'devicon-git-plain colored',
    '.sqlite': 'devicon-sqlite-plain colored',
    // codicon fallbacks (no devicon equivalent)
    '.json': 'codicon codicon-json',
    '.jsonc': 'codicon codicon-json',
    '.txt': 'codicon codicon-file',
    '.xml': 'codicon codicon-file',
    '.svg': 'codicon codicon-file-media',
    '.png': 'codicon codicon-file-media',
    '.jpg': 'codicon codicon-file-media',
    '.jpeg': 'codicon codicon-file-media',
    '.gif': 'codicon codicon-file-media',
    '.ico': 'codicon codicon-file-media',
    '.env': 'codicon codicon-settings-gear',
    '.yml': 'codicon codicon-settings-gear',
    '.yaml': 'codicon codicon-settings-gear',
    '.toml': 'codicon codicon-settings-gear',
    '.lock': 'codicon codicon-lock',
    '.sql': 'codicon codicon-database',
    '.db': 'codicon codicon-database',
  };

  return icons[ext] || 'codicon codicon-file';
}
