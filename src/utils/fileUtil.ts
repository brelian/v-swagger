import assert from 'assert';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import * as _ from 'lodash';
import path from 'path';

export const REF_HASH_SEPARATOR = `#${path.sep}`;

export function hashFileName(fileName: string): string {
    return crypto.createHash('md5').update(fileName).digest('hex').slice(0, 8);
}

/**
 * get absolute file path. e.g. /path/to/pet.yaml
 */
export function getActivatedFileName(editor?: vscode.TextEditor) {
    assert(editor);
    return editor.document.fileName;
}

/**
 * check whether the given key-value pair is an external reference
 * @param key
 * @param ref
 * @returns
 */
export function isExternal$Ref(key: string, ref: unknown): ref is string {
    return _.isString(ref) && key === '$ref' && !ref.startsWith(REF_HASH_SEPARATOR);
}
