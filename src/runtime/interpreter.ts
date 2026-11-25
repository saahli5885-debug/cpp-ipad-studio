import type {
  BlockStmt,
  Expr,
  FunctionDecl,
  ProgramNode,
  Stmt,
  StructDecl,
  TypeSpec,
  VarDeclItem,
} from './parser';

export interface Cell {
  value: RuntimeVal;
  type: TypeSpec;
}

export interface PointerVal {
  __kind: 'ptr';
  blockId: number; // 0 = nullptr
  offset: number;
  elemSize: number;
  baseAddr: number;
}

export interface VectorVal {
  __kind: 'vector';
  elemType: TypeSpec;
  cells: Cell[];
}

export interface StructVal {
  __kind: 'struct';
  structName: string;
  fields: Map<string, Cell>;
}

export interface StreamVal {
  __kind: 'stream';
  stream: 'cin' | 'cout' | 'cerr';
  ok: boolean;
}

export interface IteratorVal {
  __kind: 'iterator';
  vector: VectorVal;
  index: number;
}

export interface ManipVal {
  __kind: 'manip';
  name: 'endl' | 'fixed' | 'setprecision' | 'setw';
  arg?: number;
}

export type RuntimeVal =
  | number
  | string
  | boolean
  | null
  | undefined
  | PointerVal
  | VectorVal
  | StructVal
  | StreamVal
  | IteratorVal
  | ManipVal;

interface MemoryBlock {
  id: number;
  cells: Cell[];
  elemSize: number;
  baseAddr: number;
  freed: boolean;
}

const NULL_PTR: PointerVal = {
  __kind: 'ptr',
  blockId: 0,
  offset: 0,
  elemSize: 1,
  baseAddr: 0,
};

function isPtr(v: RuntimeVal): v is PointerVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'ptr';
}

function isVec(v: RuntimeVal): v is VectorVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'vector';
}

function isStruct(v: RuntimeVal): v is StructVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'struct';
}

function isStream(v: RuntimeVal): v is StreamVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'stream';
}

function isIterator(v: RuntimeVal): v is IteratorVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'iterator';
}

function isManip(v: RuntimeVal): v is ManipVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'manip';
}

export function sizeOfType(t: TypeSpec): number {
  if (t.pointerDepth > 0) return 8;
  switch (t.base) {
    case 'char':
    case 'bool':
      return 1;
    case 'short':
      return 2;
    case 'int':
    case 'float':
    case 'int32_t':
    case 'uint32_t':
      return 4;
    case 'double':
    case 'long':
    case 'long long':
    case 'size_t':
    case 'ssize_t':
    case 'int64_t':
    case 'uint64_t':
      return 8;
    default:
      return 8;
  }
}

function isFloatType(t: TypeSpec): boolean {
  return t.pointerDepth === 0 && (t.base === 'double' || t.base === 'float');
}

function isIntType(t: TypeSpec): boolean {
  return (
    t.pointerDepth === 0 &&
    (t.base === 'int' ||
      t.base === 'long' ||
      t.base === 'long long' ||
      t.base === 'short' ||
      t.base === 'size_t' ||
      t.base === 'ssize_t' ||
      t.base === 'int32_t' ||
      t.base === 'uint32_t' ||
      t.base === 'int64_t' ||
      t.base === 'uint64_t')
  );
}

function defaultType(base = 'int'): TypeSpec {
  return { base, pointerDepth: 0, isRef: false, isConst: false };
}

class ReturnSignal {
  constructor(readonly value: RuntimeVal) {}
}

class BreakSignal {}
class ContinueSignal {}

export class RuntimeAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeAbortError';
  }
}

export class InteractiveStdin {
  private buffer = '';
  private eof = false;
  private waiters: Array<() => void> = [];

  push(text: string): void {
    if (this.eof) return;
    this.buffer += text;
    this.notify();
  }

  close(): void {
    this.eof = true;
    this.notify();
  }

  private notify(): void {
    const list = this.waiters.splice(0, this.waiters.length);
    for (const resolve of list) resolve();
  }

  private waitForData(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      return Promise.reject(new RuntimeAbortError('Остановлено пользователем'));
    }
    if (this.buffer.length > 0 || this.eof) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const idx = this.waiters.indexOf(onReady);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new RuntimeAbortError('Остановлено пользователем'));
      };
      const onReady = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(onReady);
    });
  }

  async readToken(signal: AbortSignal): Promise<string | null> {
    while (true) {
      // Skip leading whitespace
      let start = 0;
      while (start < this.buffer.length && /\s/.test(this.buffer[start])) {
        start += 1;
      }
      if (start > 0) {
        this.buffer = this.buffer.slice(start);
      }

      if (this.buffer.length === 0) {
        if (this.eof) return null;
        await this.waitForData(signal);
        continue;
      }

      let end = 0;
      while (end < this.buffer.length && !/\s/.test(this.buffer[end])) {
        end += 1;
      }

      // If token reaches end of buffer without trailing whitespace and not EOF, wait for delimiter
      if (end === this.buffer.length && !this.eof) {
        await this.waitForData(signal);
        continue;
      }

      const token = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end);
      return token;
    }
  }

  async readChar(signal: AbortSignal, skipWhitespace = false): Promise<string | null> {
    while (true) {
      if (skipWhitespace) {
        let start = 0;
        while (start < this.buffer.length && /\s/.test(this.buffer[start])) start += 1;
        if (start > 0) this.buffer = this.buffer.slice(start);
      }
      if (this.buffer.length > 0) {
        const ch = this.buffer[0];
        this.buffer = this.buffer.slice(1);
        return ch;
      }
      if (this.eof) return null;
      await this.waitForData(signal);
    }
  }

  async readLine(signal: AbortSignal): Promise<string | null> {
    while (true) {
      const nl = this.buffer.indexOf('\n');
      if (nl !== -1) {
        const line = this.buffer.slice(0, nl).replace(/\r$/, '');
        this.buffer = this.buffer.slice(nl + 1);
        return line;
      }
      if (this.eof) {
        if (this.buffer.length === 0) return null;
        const rest = this.buffer;
        this.buffer = '';
        return rest;
      }
      await this.waitForData(signal);
    }
  }
}

interface Scope {
  parent: Scope | null;
  vars: Map<string, Cell>;
  varPtrs: Map<string, PointerVal>;
}

export interface RunCallbacks {
  onStdout: (text: string) => void;
  onStderr: (text: string) => void;
  stdin: InteractiveStdin;
  signal: AbortSignal;
}

const MAX_OUTPUT_BYTES = 256 * 1024;

export async function runProgram(program: ProgramNode, callbacks: RunCallbacks): Promise<number> {
  const { onStdout, onStderr, stdin, signal } = callbacks;

  const functions = new Map<string, FunctionDecl[]>();
  const structs = new Map<string, StructDecl>();
  const blocks = new Map<number, MemoryBlock>();
  let nextBlockId = 1;
  let nextBaseAddr = 0x55a1400010;
  let outputBytes = 0;
  let stepCounter = 0;
  let coutFixed = false;
  let coutPrecision: number | null = null;
  let coutWidth: number | null = null;
  let randSeed = 123456789;

  const emit = (target: 'stdout' | 'stderr', text: string) => {
    if (!text) return;
    outputBytes += text.length;
    if (outputBytes > MAX_OUTPUT_BYTES) {
      onStderr('\n[Вывод остановлен: превышен лимит 256 КБ]\n');
      throw new RuntimeAbortError('Превышен лимит вывода (256 КБ)');
    }
    if (target === 'stdout') onStdout(text);
    else onStderr(text);
  };

  const tick = async () => {
    stepCounter += 1;
    if (stepCounter % 2000 === 0) {
      if (signal.aborted) {
        throw new RuntimeAbortError('Остановлено пользователем');
      }
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    if (signal.aborted) {
      throw new RuntimeAbortError('Остановлено пользователем');
    }
  };

  const allocBlock = (cells: Cell[], elemSize: number): PointerVal => {
    const id = nextBlockId++;
    const alignedSize = Math.max(16, Math.ceil((cells.length * elemSize) / 16) * 16);
    const baseAddr = nextBaseAddr;
    nextBaseAddr += alignedSize + 16;
    blocks.set(id, { id, cells, elemSize, baseAddr, freed: false });
    return { __kind: 'ptr', blockId: id, offset: 0, elemSize, baseAddr };
  };

  const derefPtr = (ptr: PointerVal): Cell => {
    if (ptr.blockId === 0) {
      throw new Error('Ошибка выполнения: разыменование нулевого указателя (nullptr)');
    }
    const blk = blocks.get(ptr.blockId);
    if (!blk || blk.freed) {
      throw new Error('Ошибка выполнения: обращение к освобождённой памяти');
    }
    if (ptr.offset < 0 || ptr.offset >= blk.cells.length) {
      throw new Error(`Ошибка выполнения: выход за пределы массива (индекс ${ptr.offset})`);
    }
    return blk.cells[ptr.offset];
  };

  const defaultValueForType = (type: TypeSpec): RuntimeVal => {
    if (type.pointerDepth > 0) return NULL_PTR;
    if (type.base === 'string') return '';
    if (type.base === 'bool') return false;
    if (type.base === 'char') return '\0';
    if (type.base === 'vector') {
      const elemType = type.templateArgs?.[0] ?? defaultType('int');
      return { __kind: 'vector', elemType, cells: [] } satisfies VectorVal;
    }
    if (structs.has(type.base)) {
      const decl = structs.get(type.base)!;
      const fields = new Map<string, Cell>();
      for (const f of decl.fields) {
        fields.set(f.name, { type: f.type, value: defaultValueForType(f.type) });
      }
      return { __kind: 'struct', structName: decl.name, fields } satisfies StructVal;
    }
    return 0;
  };

  const coerceToType = (val: RuntimeVal, type: TypeSpec): RuntimeVal => {
    if (type.base === 'auto') return cloneVal(val);
    if (type.pointerDepth > 0) {
      if (isPtr(val)) {
        // Reinterpret pointer elemSize on explicit cast like (double*)malloc(...)
        const targetElemSize = sizeOfType({ ...type, pointerDepth: type.pointerDepth - 1 });
        if (val.blockId !== 0 && val.elemSize !== targetElemSize) {
          const blk = blocks.get(val.blockId);
          if (blk && blk.elemSize === 1 && targetElemSize > 1) {
            // Convert raw byte-allocated malloc buffer into typed cells
            const count = Math.max(1, Math.floor(blk.cells.length / targetElemSize));
            const elemType: TypeSpec = { ...type, pointerDepth: type.pointerDepth - 1 };
            blk.cells = Array.from({ length: count }, () => ({
              type: elemType,
              value: defaultValueForType(elemType),
            }));
            blk.elemSize = targetElemSize;
            return { ...val, elemSize: targetElemSize };
          }
        }
        return val;
      }
      if (val === 0 || val === null) return NULL_PTR;
      return val;
    }
    if (type.base === 'bool') return toBool(val);
    if (type.base === 'char') {
      if (typeof val === 'string') return val.length > 0 ? val[0] : '\0';
      if (typeof val === 'number') return String.fromCharCode(val & 0xff);
      return '\0';
    }
    if (type.base === 'string') {
      return val === undefined || val === null ? '' : String(val);
    }
    if (isIntType(type)) {
      return Math.trunc(toNumber(val));
    }
    if (isFloatType(type)) {
      return toNumber(val);
    }
    return cloneVal(val);
  };

  const cloneVal = (val: RuntimeVal): RuntimeVal => {
    if (isVec(val)) {
      return {
        __kind: 'vector',
        elemType: val.elemType,
        cells: val.cells.map((c) => ({ type: c.type, value: cloneVal(c.value) })),
      };
    }
    if (isStruct(val)) {
      const fields = new Map<string, Cell>();
      for (const [k, c] of val.fields.entries()) {
        fields.set(k, { type: c.type, value: cloneVal(c.value) });
      }
      return { __kind: 'struct', structName: val.structName, fields };
    }
    return val;
  };

  const toNumber = (val: RuntimeVal): number => {
    if (typeof val === 'number') return val;
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (typeof val === 'string') return val.length > 0 ? val.charCodeAt(0) : 0;
    if (isPtr(val)) return val.blockId === 0 ? 0 : val.baseAddr + val.offset * val.elemSize;
    if (isStream(val)) return val.ok ? 1 : 0;
    return 0;
  };

  const toBool = (val: RuntimeVal): boolean => {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    if (typeof val === 'string') return val.length > 0 && val !== '\0';
    if (isPtr(val)) return val.blockId !== 0;
    if (isStream(val)) return val.ok;
    return Boolean(val);
  };

  const formatValForStream = (val: RuntimeVal): string => {
    let str = '';
    if (typeof val === 'boolean') {
      str = val ? '1' : '0';
    } else if (typeof val === 'number') {
      if (coutFixed && coutPrecision !== null) {
        str = val.toFixed(coutPrecision);
      } else if (coutPrecision !== null) {
        str = Number(val.toPrecision(coutPrecision)).toString();
      } else {
        str = Object.is(val, -0) ? '0' : String(val);
      }
    } else if (typeof val === 'string') {
      str = val;
    } else if (isPtr(val)) {
      str = val.blockId === 0 ? '0' : `0x${(val.baseAddr + val.offset * val.elemSize).toString(16)}`;
    } else if (val === null || val === undefined) {
      str = '0';
    } else {
      str = String(val);
    }

    if (coutWidth !== null && str.length < coutWidth) {
      str = ' '.repeat(coutWidth - str.length) + str;
      coutWidth = null;
    }
    return str;
  };

  const formatPrintf = (fmt: string, args: RuntimeVal[]): string => {
    let out = '';
    let argIdx = 0;

    for (let i = 0; i < fmt.length; i++) {
      if (fmt[i] !== '%') {
        out += fmt[i];
        continue;
      }
      if (fmt[i + 1] === '%') {
        out += '%';
        i += 1;
        continue;
      }

      // Parse flags, width, precision, length modifier, specifier
      const match = fmt.slice(i).match(/^%([-+ 0#]*)(\d+)?(?:\.(\d+))?(?:hh|h|ll|l|z|L)?([diuoxXfFeEgGcsp])/);
      if (!match) {
        out += fmt[i];
        continue;
      }

      const [full, flags, widthStr, precStr, spec] = match;
      i += full.length - 1;
      const arg = args[argIdx++];
      let formatted = '';

      switch (spec) {
        case 'd':
        case 'i':
          formatted = String(Math.trunc(toNumber(arg)));
          break;
        case 'u':
          formatted = String(Math.trunc(toNumber(arg)) >>> 0);
          break;
        case 'o':
          formatted = (Math.trunc(toNumber(arg)) >>> 0).toString(8);
          break;
        case 'x':
          formatted = (Math.trunc(toNumber(arg)) >>> 0).toString(16);
          break;
        case 'X':
          formatted = (Math.trunc(toNumber(arg)) >>> 0).toString(16).toUpperCase();
          break;
        case 'f':
        case 'F': {
          const prec = precStr !== undefined ? Number.parseInt(precStr, 10) : 6;
          formatted = toNumber(arg).toFixed(prec);
          break;
        }
        case 'e':
        case 'E': {
          const prec = precStr !== undefined ? Number.parseInt(precStr, 10) : 6;
          const raw = toNumber(arg).toExponential(prec);
          formatted = spec === 'E' ? raw.toUpperCase() : raw;
          break;
        }
        case 'g':
        case 'G': {
          const prec = precStr !== undefined ? Number.parseInt(precStr, 10) : 6;
          const raw = Number(toNumber(arg).toPrecision(Math.max(1, prec))).toString();
          formatted = spec === 'G' ? raw.toUpperCase() : raw;
          break;
        }
        case 'c':
          if (typeof arg === 'string') formatted = arg[0] ?? '';
          else formatted = String.fromCharCode(Math.trunc(toNumber(arg)) & 0xff);
          break;
        case 's':
          if (typeof arg === 'string') {
            formatted = arg;
          } else if (isPtr(arg) && arg.blockId !== 0) {
            const blk = blocks.get(arg.blockId);
            if (blk) {
              let str = '';
              for (let k = arg.offset; k < blk.cells.length; k++) {
                const c = blk.cells[k].value;
                if (c === '\0' || c === 0) break;
                str += typeof c === 'string' ? c : String.fromCharCode(Number(c));
              }
              formatted = str;
            }
          } else {
            formatted = String(arg ?? '');
          }
          break;
        case 'p':
          if (isPtr(arg)) {
            formatted =
              arg.blockId === 0
                ? '(nil)'
                : `0x${(arg.baseAddr + arg.offset * arg.elemSize).toString(16)}`;
          } else {
            formatted = `0x${Math.trunc(toNumber(arg)).toString(16)}`;
          }
          break;
        default:
          formatted = String(arg ?? '');
      }

      if (widthStr) {
        const width = Number.parseInt(widthStr, 10);
        if (formatted.length < width) {
          const padChar = flags.includes('0') && !flags.includes('-') ? '0' : ' ';
          const pad = padChar.repeat(width - formatted.length);
          formatted = flags.includes('-') ? formatted + pad : pad + formatted;
        }
      }

      out += formatted;
    }

    return out;
  };

  const executeScanf = async (fmt: string, args: RuntimeVal[]): Promise<number> => {
    let matched = 0;
    let argIdx = 0;

    for (let i = 0; i < fmt.length; i++) {
      if (/\s/.test(fmt[i])) continue;
      if (fmt[i] !== '%') continue;
      if (fmt[i + 1] === '%') {
        i += 1;
        continue;
      }

      const match = fmt.slice(i).match(/^%(?:\d+)?(?:hh|h|ll|l|L)?([diuoxXfFeEgGcs])/);
      if (!match) continue;
      const [full, spec] = match;
      i += full.length - 1;

      const target = args[argIdx++];
      if (!isPtr(target)) {
        throw new Error('scanf ожидает указатель (например, &x или arr + i)');
      }
      const cell = derefPtr(target);

      if (spec === 'c') {
        const skipWs = i > full.length && /\s/.test(fmt[i - full.length]);
        const ch = await stdin.readChar(signal, skipWs);
        if (ch === null) return matched === 0 ? -1 : matched;
        cell.value = ch;
        matched += 1;
        continue;
      }

      const token = await stdin.readToken(signal);
      if (token === null) return matched === 0 ? -1 : matched;

      if (spec === 's') {
        if (cell.type.base === 'char' && target.blockId !== 0) {
          const blk = blocks.get(target.blockId);
          if (blk) {
            for (let k = 0; k < token.length && target.offset + k < blk.cells.length - 1; k++) {
              blk.cells[target.offset + k].value = token[k];
            }
            if (target.offset + token.length < blk.cells.length) {
              blk.cells[target.offset + token.length].value = '\0';
            }
          }
        } else {
          cell.value = token;
        }
        matched += 1;
      } else if (spec === 'd' || spec === 'i' || spec === 'u' || spec === 'x' || spec === 'X' || spec === 'o') {
        const radix = spec === 'x' || spec === 'X' ? 16 : spec === 'o' ? 8 : 10;
        const parsed = Number.parseInt(token, radix);
        if (Number.isNaN(parsed)) return matched;
        cell.value = parsed;
        matched += 1;
      } else {
        const parsed = Number.parseFloat(token);
        if (Number.isNaN(parsed)) return matched;
        cell.value = parsed;
        matched += 1;
      }
    }

    return matched;
  };

  const readIntoCell = async (cell: Cell): Promise<boolean> => {
    if (cell.type.base === 'char' && cell.type.pointerDepth === 0) {
      const ch = await stdin.readChar(signal, true);
      if (ch === null) return false;
      cell.value = ch;
      return true;
    }

    const token = await stdin.readToken(signal);
    if (token === null) return false;

    if (cell.type.base === 'string') {
      cell.value = token;
      return true;
    }
    if (cell.type.base === 'bool') {
      cell.value = token !== '0' && token.toLowerCase() !== 'false';
      return true;
    }
    if (isIntType(cell.type)) {
      const parsed = Number.parseInt(token, 10);
      if (Number.isNaN(parsed)) return false;
      cell.value = parsed;
      return true;
    }
    const parsed = Number.parseFloat(token);
    if (Number.isNaN(parsed)) return false;
    cell.value = parsed;
    return true;
  };

  const createScope = (parent: Scope | null): Scope => ({
    parent,
    vars: new Map(),
    varPtrs: new Map(),
  });

  const lookupCell = (scope: Scope, name: string): { cell: Cell; ownerScope: Scope } | null => {
    let cur: Scope | null = scope;
    while (cur) {
      const found = cur.vars.get(name);
      if (found) return { cell: found, ownerScope: cur };
      cur = cur.parent;
    }
    return null;
  };

  const getAddressOfVar = (ownerScope: Scope, name: string, cell: Cell): PointerVal => {
    const existing = ownerScope.varPtrs.get(name);
    if (existing) return existing;
    const ptr = allocBlock([cell], sizeOfType(cell.type));
    ownerScope.varPtrs.set(name, ptr);
    return ptr;
  };

  const resolveLValue = async (
    expr: Expr,
    scope: Scope
  ): Promise<{ cell: Cell; getPtr: () => PointerVal }> => {
    if (expr.kind === 'ident') {
      const found = lookupCell(scope, expr.name);
      if (!found) {
        throw new Error(`Строка ${expr.line}: необъявленный идентификатор '${expr.name}'`);
      }
      return {
        cell: found.cell,
        getPtr: () => getAddressOfVar(found.ownerScope, expr.name, found.cell),
      };
    }

    if (expr.kind === 'unary' && expr.op === '*') {
      const ptrVal = await evalExpr(expr.arg, scope);
      if (!isPtr(ptrVal)) {
        throw new Error(`Строка ${expr.line}: попытка разыменовать не-указатель`);
      }
      return {
        cell: derefPtr(ptrVal),
        getPtr: () => ptrVal,
      };
    }

    if (expr.kind === 'index') {
      const target = await evalExpr(expr.target, scope);
      const idx = Math.trunc(toNumber(await evalExpr(expr.index, scope)));
      if (isPtr(target)) {
        const elemPtr: PointerVal = { ...target, offset: target.offset + idx };
        return {
          cell: derefPtr(elemPtr),
          getPtr: () => elemPtr,
        };
      }
      if (isVec(target)) {
        if (idx < 0 || idx >= target.cells.length) {
          throw new Error(`Строка ${expr.line}: индекс vector (${idx}) вне диапазона (размер ${target.cells.length})`);
        }
        const cell = target.cells[idx];
        return {
          cell,
          getPtr: () => allocBlock([cell], sizeOfType(cell.type)),
        };
      }
      if (typeof target === 'string') {
        const ch = target[idx] ?? '\0';
        const cell: Cell = { type: defaultType('char'), value: ch };
        return {
          cell,
          getPtr: () => allocBlock([cell], 1),
        };
      }
      throw new Error(`Строка ${expr.line}: индексация применена к неподдерживаемому типу`);
    }

    if (expr.kind === 'member') {
      let base = await evalExpr(expr.target, scope);
      if (expr.isArrow) {
        if (!isPtr(base)) throw new Error(`Строка ${expr.line}: оператор '->' требует указатель`);
        base = derefPtr(base).value;
      }
      if (isStruct(base)) {
        const field = base.fields.get(expr.prop);
        if (!field) {
          throw new Error(`Строка ${expr.line}: у '${base.structName}' нет поля '${expr.prop}'`);
        }
        return {
          cell: field,
          getPtr: () => allocBlock([field], sizeOfType(field.type)),
        };
      }
    }

    throw new Error(`Строка ${expr.line}: выражение не может использоваться как lvalue`);
  };

  const declareVarItem = async (item: VarDeclItem, scope: Scope): Promise<void> => {
    // Fixed-size array declaration: `int a[5]` or `int a[] = {1, 2, 3}`
    if (item.arraySizes && item.arraySizes.length > 0) {
      let length = Math.trunc(toNumber(await evalExpr(item.arraySizes[0], scope)));
      const elemType: TypeSpec = { ...item.type };
      const initVals: RuntimeVal[] = [];

      if (item.init?.kind === 'init_list') {
        for (const el of item.init.elements) {
          initVals.push(coerceToType(await evalExpr(el, scope), elemType));
        }
      } else if (item.init?.kind === 'string' && elemType.base === 'char') {
        for (const ch of item.init.value) initVals.push(ch);
        initVals.push('\0');
      }

      if (length < 0) length = Math.max(1, initVals.length);
      const cells: Cell[] = Array.from({ length }, (_, idx) => ({
        type: elemType,
        value: idx < initVals.length ? initVals[idx] : defaultValueForType(elemType),
      }));
      const ptr = allocBlock(cells, sizeOfType(elemType));
      const arrType: TypeSpec = { ...elemType, pointerDepth: elemType.pointerDepth + 1 };
      scope.vars.set(item.name, { type: arrType, value: ptr });
      return;
    }

    // Reference binding: `int &r = x;`
    if (item.type.isRef && item.init) {
      const target = await resolveLValue(item.init, scope);
      scope.vars.set(item.name, target.cell);
      return;
    }

    // Constructor-style initialization: `vector<int> nums(n)` or `vector<int> nums(n, 0)`
    if (item.type.base === 'vector' && item.type.pointerDepth === 0) {
      const elemType = item.type.templateArgs?.[0] ?? defaultType('int');
      let cells: Cell[] = [];
      if (item.ctorArgs && item.ctorArgs.length > 0) {
        const count = Math.max(0, Math.trunc(toNumber(await evalExpr(item.ctorArgs[0], scope))));
        const fillVal =
          item.ctorArgs.length > 1
            ? coerceToType(await evalExpr(item.ctorArgs[1], scope), elemType)
            : defaultValueForType(elemType);
        cells = Array.from({ length: count }, () => ({ type: elemType, value: cloneVal(fillVal) }));
      } else if (item.init?.kind === 'init_list') {
        for (const el of item.init.elements) {
          cells.push({ type: elemType, value: coerceToType(await evalExpr(el, scope), elemType) });
        }
      } else if (item.init) {
        const val = await evalExpr(item.init, scope);
        if (isVec(val)) {
          cells = val.cells.map((c) => ({ type: elemType, value: cloneVal(c.value) }));
        }
      }
      scope.vars.set(item.name, {
        type: item.type,
        value: { __kind: 'vector', elemType, cells } satisfies VectorVal,
      });
      return;
    }

    let value: RuntimeVal;
    let resolvedType = item.type;

    if (item.init) {
      if (item.init.kind === 'init_list' && structs.has(item.type.base)) {
        const structVal = defaultValueForType(item.type) as StructVal;
        const fieldEntries = Array.from(structVal.fields.values());
        for (let k = 0; k < item.init.elements.length && k < fieldEntries.length; k++) {
          fieldEntries[k].value = coerceToType(
            await evalExpr(item.init.elements[k], scope),
            fieldEntries[k].type
          );
        }
        value = structVal;
      } else {
        const raw = await evalExpr(item.init, scope);
        if (item.type.base === 'auto') {
          if (typeof raw === 'string') resolvedType = defaultType('string');
          else if (typeof raw === 'boolean') resolvedType = defaultType('bool');
          else if (typeof raw === 'number' && !Number.isInteger(raw)) resolvedType = defaultType('double');
          else if (isPtr(raw)) resolvedType = { base: 'int', pointerDepth: 1, isRef: false, isConst: false };
          else if (isVec(raw)) resolvedType = { base: 'vector', templateArgs: [raw.elemType], pointerDepth: 0, isRef: false, isConst: false };
          else resolvedType = defaultType('int');
        }
        value = coerceToType(raw, resolvedType);
      }
    } else if (item.ctorArgs && item.ctorArgs.length > 0) {
      const first = await evalExpr(item.ctorArgs[0], scope);
      value = coerceToType(first, item.type);
    } else {
      value = defaultValueForType(item.type);
    }

    scope.vars.set(item.name, { type: resolvedType, value });
  };

  const callBuiltinFunction = async (
    name: string,
    args: Expr[],
    scope: Scope
  ): Promise<{ handled: true; value: RuntimeVal } | { handled: false }> => {
    if (name === 'printf') {
      const evalArgs: RuntimeVal[] = [];
      for (const a of args) evalArgs.push(await evalExpr(a, scope));
      const fmt = String(evalArgs[0] ?? '');
      const text = formatPrintf(fmt, evalArgs.slice(1));
      emit('stdout', text);
      return { handled: true, value: text.length };
    }

    if (name === 'scanf') {
      const evalArgs: RuntimeVal[] = [];
      for (const a of args) evalArgs.push(await evalExpr(a, scope));
      const fmt = String(evalArgs[0] ?? '');
      const count = await executeScanf(fmt, evalArgs.slice(1));
      return { handled: true, value: count };
    }

    if (name === 'puts') {
      const val = args[0] ? await evalExpr(args[0], scope) : '';
      emit('stdout', `${formatPrintf('%s', [val])}\n`);
      return { handled: true, value: 0 };
    }

    if (name === 'putchar') {
      const val = args[0] ? await evalExpr(args[0], scope) : 0;
      const ch = typeof val === 'string' ? val[0] ?? '' : String.fromCharCode(toNumber(val) & 0xff);
      emit('stdout', ch);
      return { handled: true, value: ch.charCodeAt(0) || 0 };
    }

    if (name === 'getchar') {
      const ch = await stdin.readChar(signal, false);
      return { handled: true, value: ch === null ? -1 : ch.charCodeAt(0) };
    }

    if (name === 'getline') {
      if (args.length < 2) return { handled: true, value: { __kind: 'stream', stream: 'cin', ok: false } };
      const target = await resolveLValue(args[1], scope);
      const line = await stdin.readLine(signal);
      if (line === null) {
        return { handled: true, value: { __kind: 'stream', stream: 'cin', ok: false } satisfies StreamVal };
      }
      target.cell.value = line;
      return { handled: true, value: { __kind: 'stream', stream: 'cin', ok: true } satisfies StreamVal };
    }

    if (name === 'setprecision') {
      const n = Math.trunc(toNumber(await evalExpr(args[0], scope)));
      return { handled: true, value: { __kind: 'manip', name: 'setprecision', arg: n } satisfies ManipVal };
    }

    if (name === 'setw') {
      const n = Math.trunc(toNumber(await evalExpr(args[0], scope)));
      return { handled: true, value: { __kind: 'manip', name: 'setw', arg: n } satisfies ManipVal };
    }

    if (name === 'malloc' || name === 'calloc') {
      let bytes = 0;
      if (name === 'malloc') {
        bytes = Math.max(1, Math.trunc(toNumber(await evalExpr(args[0], scope))));
      } else {
        const count = Math.max(1, Math.trunc(toNumber(await evalExpr(args[0], scope))));
        const sz = Math.max(1, Math.trunc(toNumber(await evalExpr(args[1], scope))));
        bytes = count * sz;
      }
      const byteCells: Cell[] = Array.from({ length: Math.min(bytes, 4_000_000) }, () => ({
        type: defaultType('char'),
        value: 0,
      }));
      return { handled: true, value: allocBlock(byteCells, 1) };
    }

    if (name === 'free') {
      const ptr = await evalExpr(args[0], scope);
      if (isPtr(ptr) && ptr.blockId !== 0) {
        const blk = blocks.get(ptr.blockId);
        if (blk) blk.freed = true;
      }
      return { handled: true, value: undefined };
    }

    if (name === 'sort') {
      const first = await evalExpr(args[0], scope);
      const last = await evalExpr(args[1], scope);
      if (isIterator(first) && isIterator(last) && first.vector === last.vector) {
        const slice = first.vector.cells.slice(first.index, last.index);
        slice.sort((a, b) => {
          if (typeof a.value === 'string' && typeof b.value === 'string') {
            return a.value.localeCompare(b.value);
          }
          return toNumber(a.value) - toNumber(b.value);
        });
        for (let i = 0; i < slice.length; i++) {
          first.vector.cells[first.index + i] = slice[i];
        }
      } else if (isPtr(first) && isPtr(last) && first.blockId === last.blockId) {
        const blk = blocks.get(first.blockId);
        if (blk) {
          const slice = blk.cells.slice(first.offset, last.offset);
          slice.sort((a, b) => toNumber(a.value) - toNumber(b.value));
          for (let i = 0; i < slice.length; i++) {
            blk.cells[first.offset + i] = slice[i];
          }
        }
      }
      return { handled: true, value: undefined };
    }

    if (name === 'reverse') {
      const first = await evalExpr(args[0], scope);
      const last = await evalExpr(args[1], scope);
      if (isIterator(first) && isIterator(last) && first.vector === last.vector) {
        const slice = first.vector.cells.slice(first.index, last.index).reverse();
        for (let i = 0; i < slice.length; i++) {
          first.vector.cells[first.index + i] = slice[i];
        }
      }
      return { handled: true, value: undefined };
    }

    if (name === 'swap') {
      const a = await resolveLValue(args[0], scope);
      const b = await resolveLValue(args[1], scope);
      const tmp = a.cell.value;
      a.cell.value = b.cell.value;
      b.cell.value = tmp;
      return { handled: true, value: undefined };
    }

    if (name === 'min' || name === 'max') {
      const a = toNumber(await evalExpr(args[0], scope));
      const b = toNumber(await evalExpr(args[1], scope));
      return { handled: true, value: name === 'min' ? Math.min(a, b) : Math.max(a, b) };
    }

    // Math & string helpers
    const math1: Record<string, (x: number) => number> = {
      sqrt: Math.sqrt,
      abs: Math.abs,
      fabs: Math.abs,
      llabs: Math.abs,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      asin: Math.asin,
      acos: Math.acos,
      atan: Math.atan,
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
      log: Math.log,
      log10: Math.log10,
      log2: Math.log2,
      exp: Math.exp,
    };
    if (name in math1) {
      const x = toNumber(await evalExpr(args[0], scope));
      return { handled: true, value: math1[name](x) };
    }
    if (name === 'pow') {
      const a = toNumber(await evalExpr(args[0], scope));
      const b = toNumber(await evalExpr(args[1], scope));
      return { handled: true, value: Math.pow(a, b) };
    }
    if (name === 'fmod') {
      const a = toNumber(await evalExpr(args[0], scope));
      const b = toNumber(await evalExpr(args[1], scope));
      return { handled: true, value: a % b };
    }
    if (name === 'strlen') {
      const v = await evalExpr(args[0], scope);
      return { handled: true, value: formatPrintf('%s', [v]).length };
    }
    if (name === 'strcmp') {
      const a = formatPrintf('%s', [await evalExpr(args[0], scope)]);
      const b = formatPrintf('%s', [await evalExpr(args[1], scope)]);
      return { handled: true, value: a < b ? -1 : a > b ? 1 : 0 };
    }
    if (name === 'to_string') {
      return { handled: true, value: formatValForStream(await evalExpr(args[0], scope)) };
    }
    if (name === 'stoi' || name === 'atoi') {
      return { handled: true, value: Number.parseInt(String(await evalExpr(args[0], scope)), 10) || 0 };
    }
    if (name === 'stod' || name === 'atof') {
      return { handled: true, value: Number.parseFloat(String(await evalExpr(args[0], scope))) || 0 };
    }
    if (name === 'srand') {
      randSeed = Math.trunc(toNumber(await evalExpr(args[0], scope))) || 1;
      return { handled: true, value: undefined };
    }
    if (name === 'rand') {
      randSeed = (1103515245 * randSeed + 12345) & 0x7fffffff;
      return { handled: true, value: randSeed };
    }
    if (name === 'exit') {
      const code = args[0] ? Math.trunc(toNumber(await evalExpr(args[0], scope))) : 0;
      throw new ReturnSignal(code);
    }

    return { handled: false };
  };

  const invokeUserFunction = async (
    decl: FunctionDecl,
    args: Expr[],
    callerScope: Scope,
    thisObj?: StructVal
  ): Promise<RuntimeVal> => {
    const fnScope = createScope(globalScope);

    if (thisObj) {
      fnScope.vars.set('this', {
        type: { base: thisObj.structName, pointerDepth: 1, isRef: false, isConst: false },
        value: allocBlock([{ type: defaultType(thisObj.structName), value: thisObj }], 8),
      });
      for (const [fieldName, cell] of thisObj.fields.entries()) {
        fnScope.vars.set(fieldName, cell);
      }
    }

    for (let i = 0; i < decl.params.length; i++) {
      const param = decl.params[i];
      if (i < args.length) {
        if (param.type.isRef) {
          const lv = await resolveLValue(args[i], callerScope);
          fnScope.vars.set(param.name, lv.cell);
        } else {
          const argVal = await evalExpr(args[i], callerScope);
          fnScope.vars.set(param.name, {
            type: param.type,
            value: coerceToType(argVal, param.type),
          });
        }
      } else if (param.defaultValue) {
        const defVal = await evalExpr(param.defaultValue, globalScope);
        fnScope.vars.set(param.name, {
          type: param.type,
          value: coerceToType(defVal, param.type),
        });
      }
    }

    if (!decl.body) return undefined;

    try {
      await execBlock(decl.body, fnScope, false);
    } catch (sig) {
      if (sig instanceof ReturnSignal) {
        if (decl.returnType.base === 'void' && decl.returnType.pointerDepth === 0) {
          return undefined;
        }
        return coerceToType(sig.value, decl.returnType);
      }
      throw sig;
    }

    return decl.name === 'main' ? 0 : undefined;
  };

  const evalExpr = async (expr: Expr, scope: Scope): Promise<RuntimeVal> => {
    await tick();

    switch (expr.kind) {
      case 'number':
        return expr.value;
      case 'string':
        return expr.value;
      case 'char':
        return expr.value;
      case 'bool':
        return expr.value;
      case 'null':
        return NULL_PTR;
      case 'init_list':
        return {
          __kind: 'vector',
          elemType: defaultType('auto'),
          cells: await Promise.all(
            expr.elements.map(async (e) => ({
              type: defaultType('auto'),
              value: await evalExpr(e, scope),
            }))
          ),
        } satisfies VectorVal;

      case 'ident': {
        if (expr.name === 'cout') return { __kind: 'stream', stream: 'cout', ok: true } satisfies StreamVal;
        if (expr.name === 'cerr') return { __kind: 'stream', stream: 'cerr', ok: true } satisfies StreamVal;
        if (expr.name === 'cin') return { __kind: 'stream', stream: 'cin', ok: true } satisfies StreamVal;
        if (expr.name === 'endl') return { __kind: 'manip', name: 'endl' } satisfies ManipVal;
        if (expr.name === 'fixed') return { __kind: 'manip', name: 'fixed' } satisfies ManipVal;

        const found = lookupCell(scope, expr.name);
        if (!found) {
          throw new Error(`Строка ${expr.line}: необъявленная переменная '${expr.name}'`);
        }
        return found.cell.value;
      }

      case 'sizeof': {
        if (expr.targetType) return sizeOfType(expr.targetType);
        if (expr.expr) {
          const val = await evalExpr(expr.expr, scope);
          if (isPtr(val)) return 8;
          if (typeof val === 'string') return val.length + 1;
          return 4;
        }
        return 4;
      }

      case 'cast': {
        const val = await evalExpr(expr.expr, scope);
        return coerceToType(val, expr.targetType);
      }

      case 'new': {
        const elemSize = sizeOfType(expr.allocType);
        if (expr.count) {
          const count = Math.max(0, Math.trunc(toNumber(await evalExpr(expr.count, scope))));
          const cells: Cell[] = Array.from({ length: count }, () => ({
            type: expr.allocType,
            value: defaultValueForType(expr.allocType),
          }));
          return allocBlock(cells, elemSize);
        }
        const initial =
          expr.args && expr.args.length > 0
            ? coerceToType(await evalExpr(expr.args[0], scope), expr.allocType)
            : defaultValueForType(expr.allocType);
        return allocBlock([{ type: expr.allocType, value: initial }], elemSize);
      }

      case 'delete': {
        const ptr = await evalExpr(expr.target, scope);
        if (isPtr(ptr) && ptr.blockId !== 0) {
          const blk = blocks.get(ptr.blockId);
          if (blk) blk.freed = true;
        }
        return undefined;
      }

      case 'unary': {
        if (expr.op === '&') {
          const lv = await resolveLValue(expr.arg, scope);
          return lv.getPtr();
        }
        if (expr.op === '*') {
          const ptr = await evalExpr(expr.arg, scope);
          if (!isPtr(ptr)) throw new Error(`Строка ${expr.line}: разыменование не-указателя`);
          return derefPtr(ptr).value;
        }
        if (expr.op === '++' || expr.op === '--') {
          const lv = await resolveLValue(expr.arg, scope);
          const delta = expr.op === '++' ? 1 : -1;
          if (isPtr(lv.cell.value)) {
            lv.cell.value = { ...lv.cell.value, offset: lv.cell.value.offset + delta };
          } else {
            lv.cell.value = coerceToType(toNumber(lv.cell.value) + delta, lv.cell.type);
          }
          return lv.cell.value;
        }
        const val = await evalExpr(expr.arg, scope);
        if (expr.op === '+') return toNumber(val);
        if (expr.op === '-') return -toNumber(val);
        if (expr.op === '!') return !toBool(val);
        if (expr.op === '~') return ~Math.trunc(toNumber(val));
        return val;
      }

      case 'postfix': {
        const lv = await resolveLValue(expr.arg, scope);
        const prev = lv.cell.value;
        const delta = expr.op === '++' ? 1 : -1;
        if (isPtr(prev)) {
          lv.cell.value = { ...prev, offset: prev.offset + delta };
        } else {
          lv.cell.value = coerceToType(toNumber(prev) + delta, lv.cell.type);
        }
        return prev;
      }

      case 'assign': {
        const lv = await resolveLValue(expr.left, scope);
        const rhs = await evalExpr(expr.right, scope);
        if (expr.op === '=') {
          lv.cell.value = coerceToType(rhs, lv.cell.type);
          return lv.cell.value;
        }
        const cur = lv.cell.value;
        if (expr.op === '+=' && typeof cur === 'string') {
          lv.cell.value = cur + String(rhs);
          return lv.cell.value;
        }
        if (expr.op === '+=' && isPtr(cur)) {
          lv.cell.value = { ...cur, offset: cur.offset + Math.trunc(toNumber(rhs)) };
          return lv.cell.value;
        }
        if (expr.op === '-=' && isPtr(cur)) {
          lv.cell.value = { ...cur, offset: cur.offset - Math.trunc(toNumber(rhs)) };
          return lv.cell.value;
        }
        const a = toNumber(cur);
        const b = toNumber(rhs);
        let next = a;
        switch (expr.op) {
          case '+=': next = a + b; break;
          case '-=': next = a - b; break;
          case '*=': next = a * b; break;
          case '/=':
            if (b === 0) throw new Error(`Строка ${expr.line}: деление на ноль`);
            next = isIntType(lv.cell.type) ? Math.trunc(a / b) : a / b;
            break;
          case '%=':
            if (b === 0) throw new Error(`Строка ${expr.line}: остаток от деления на ноль`);
            next = Math.trunc(a) % Math.trunc(b);
            break;
          case '&=': next = Math.trunc(a) & Math.trunc(b); break;
          case '|=': next = Math.trunc(a) | Math.trunc(b); break;
          case '^=': next = Math.trunc(a) ^ Math.trunc(b); break;
          case '<<=': next = Math.trunc(a) << Math.trunc(b); break;
          case '>>=': next = Math.trunc(a) >> Math.trunc(b); break;
        }
        lv.cell.value = coerceToType(next, lv.cell.type);
        return lv.cell.value;
      }

      case 'ternary': {
        const cond = toBool(await evalExpr(expr.cond, scope));
        return cond ? evalExpr(expr.thenExpr, scope) : evalExpr(expr.elseExpr, scope);
      }

      case 'index': {
        const lv = await resolveLValue(expr, scope);
        return lv.cell.value;
      }

      case 'member': {
        let base = await evalExpr(expr.target, scope);
        if (expr.isArrow) {
          if (!isPtr(base)) throw new Error(`Строка ${expr.line}: оператор '->' требует указатель`);
          base = derefPtr(base).value;
        }
        if (isStruct(base)) {
          const field = base.fields.get(expr.prop);
          if (field) return field.value;
        }
        return undefined;
      }

      case 'call': {
        // Member method calls: vec.size(), vec.push_back(x), str.substr(...), struct.method(...)
        if (expr.callee.kind === 'member') {
          let target = await evalExpr(expr.callee.target, scope);
          if (expr.callee.isArrow && isPtr(target)) {
            target = derefPtr(target).value;
          }
          const method = expr.callee.prop;

          if (isVec(target)) {
            if (method === 'size') return target.cells.length;
            if (method === 'empty') return target.cells.length === 0;
            if (method === 'front') {
              if (target.cells.length === 0) throw new Error(`Строка ${expr.line}: обращение к front() пустого vector`);
              return target.cells[0].value;
            }
            if (method === 'back') {
              if (target.cells.length === 0) throw new Error(`Строка ${expr.line}: обращение к back() пустого vector`);
              return target.cells[target.cells.length - 1].value;
            }
            if (method === 'push_back' || method === 'emplace_back') {
              const v = await evalExpr(expr.args[0], scope);
              target.cells.push({ type: target.elemType, value: coerceToType(v, target.elemType) });
              return undefined;
            }
            if (method === 'pop_back') {
              target.cells.pop();
              return undefined;
            }
            if (method === 'clear') {
              target.cells.length = 0;
              return undefined;
            }
            if (method === 'resize') {
              const newSize = Math.max(0, Math.trunc(toNumber(await evalExpr(expr.args[0], scope))));
              const fill =
                expr.args.length > 1
                  ? coerceToType(await evalExpr(expr.args[1], scope), target.elemType)
                  : defaultValueForType(target.elemType);
              while (target.cells.length < newSize) {
                target.cells.push({ type: target.elemType, value: cloneVal(fill) });
              }
              target.cells.length = newSize;
              return undefined;
            }
            if (method === 'begin') {
              return { __kind: 'iterator', vector: target, index: 0 } satisfies IteratorVal;
            }
            if (method === 'end') {
              return { __kind: 'iterator', vector: target, index: target.cells.length } satisfies IteratorVal;
            }
          }

          if (typeof target === 'string') {
            if (method === 'size' || method === 'length') return target.length;
            if (method === 'empty') return target.length === 0;
            if (method === 'substr') {
              const start = Math.trunc(toNumber(await evalExpr(expr.args[0], scope)));
              const len =
                expr.args.length > 1
                  ? Math.trunc(toNumber(await evalExpr(expr.args[1], scope)))
                  : target.length - start;
              return target.slice(start, start + len);
            }
            if (method === 'find') {
              const needle = String(await evalExpr(expr.args[0], scope));
              const idx = target.indexOf(needle);
              return idx === -1 ? -1 : idx;
            }
            if (method === 'c_str') return target;
          }

          if (isStruct(target)) {
            const decl = structs.get(target.structName);
            const fn = decl?.methods.find((m) => m.name === method);
            if (fn) {
              return invokeUserFunction(fn, expr.args, scope, target);
            }
          }

          throw new Error(`Строка ${expr.line}: неизвестный метод '${method}'`);
        }

        if (expr.callee.kind === 'ident') {
          const fnName = expr.callee.name;
          const builtin = await callBuiltinFunction(fnName, expr.args, scope);
          if (builtin.handled) return builtin.value;

          const overloads = functions.get(fnName);
          if (overloads && overloads.length > 0) {
            const matched =
              overloads.find((f) => f.params.length === expr.args.length && f.body) ??
              overloads.find((f) => f.body) ??
              overloads[0];
            return invokeUserFunction(matched, expr.args, scope);
          }

          throw new Error(`Строка ${expr.line}: неизвестная функция '${fnName}'`);
        }

        throw new Error(`Строка ${expr.line}: выражение не является вызываемой функцией`);
      }

      case 'binary': {
        // Short-circuit logical operators
        if (expr.op === '&&') {
          const left = await evalExpr(expr.left, scope);
          if (!toBool(left)) return false;
          return toBool(await evalExpr(expr.right, scope));
        }
        if (expr.op === '||') {
          const left = await evalExpr(expr.left, scope);
          if (toBool(left)) return true;
          return toBool(await evalExpr(expr.right, scope));
        }
        if (expr.op === ',') {
          await evalExpr(expr.left, scope);
          return evalExpr(expr.right, scope);
        }

        const leftVal = await evalExpr(expr.left, scope);

        // Stream output: `cout << ...` / `cerr << ...`
        if (expr.op === '<<' && isStream(leftVal) && (leftVal.stream === 'cout' || leftVal.stream === 'cerr')) {
          const rightVal = await evalExpr(expr.right, scope);
          if (isManip(rightVal)) {
            if (rightVal.name === 'endl') emit(leftVal.stream === 'cout' ? 'stdout' : 'stderr', '\n');
            else if (rightVal.name === 'fixed') coutFixed = true;
            else if (rightVal.name === 'setprecision') coutPrecision = rightVal.arg ?? 6;
            else if (rightVal.name === 'setw') coutWidth = rightVal.arg ?? 0;
          } else {
            emit(leftVal.stream === 'cout' ? 'stdout' : 'stderr', formatValForStream(rightVal));
          }
          return leftVal;
        }

        // Stream input: `cin >> var`
        if (expr.op === '>>' && isStream(leftVal) && leftVal.stream === 'cin') {
          if (!leftVal.ok) return leftVal;
          const lv = await resolveLValue(expr.right, scope);
          const ok = await readIntoCell(lv.cell);
          return { __kind: 'stream', stream: 'cin', ok } satisfies StreamVal;
        }

        const rightVal = await evalExpr(expr.right, scope);

        // Pointer & iterator arithmetic
        if (expr.op === '+') {
          if (isPtr(leftVal)) {
            return { ...leftVal, offset: leftVal.offset + Math.trunc(toNumber(rightVal)) } satisfies PointerVal;
          }
          if (isPtr(rightVal)) {
            return { ...rightVal, offset: rightVal.offset + Math.trunc(toNumber(leftVal)) } satisfies PointerVal;
          }
          if (isIterator(leftVal)) {
            return { ...leftVal, index: leftVal.index + Math.trunc(toNumber(rightVal)) } satisfies IteratorVal;
          }
          if (typeof leftVal === 'string' && typeof rightVal === 'string') {
            return leftVal + rightVal;
          }
          return toNumber(leftVal) + toNumber(rightVal);
        }

        if (expr.op === '-') {
          if (isPtr(leftVal) && isPtr(rightVal)) {
            return leftVal.offset - rightVal.offset;
          }
          if (isPtr(leftVal)) {
            return { ...leftVal, offset: leftVal.offset - Math.trunc(toNumber(rightVal)) } satisfies PointerVal;
          }
          if (isIterator(leftVal)) {
            return { ...leftVal, index: leftVal.index - Math.trunc(toNumber(rightVal)) } satisfies IteratorVal;
          }
          return toNumber(leftVal) - toNumber(rightVal);
        }

        // String equality/comparison
        if (typeof leftVal === 'string' && typeof rightVal === 'string' && leftVal.length !== 1 && rightVal.length !== 1) {
          switch (expr.op) {
            case '==': return leftVal === rightVal;
            case '!=': return leftVal !== rightVal;
            case '<': return leftVal < rightVal;
            case '<=': return leftVal <= rightVal;
            case '>': return leftVal > rightVal;
            case '>=': return leftVal >= rightVal;
          }
        }

        const a = toNumber(leftVal);
        const b = toNumber(rightVal);
        const bothInts =
          Number.isInteger(a) &&
          Number.isInteger(b) &&
          !(expr.left.kind === 'number' && expr.left.isFloat) &&
          !(expr.right.kind === 'number' && expr.right.isFloat) &&
          !(expr.left.kind === 'cast' && isFloatType(expr.left.targetType)) &&
          !(expr.right.kind === 'cast' && isFloatType(expr.right.targetType));

        switch (expr.op) {
          case '*': return a * b;
          case '/':
            if (b === 0) throw new Error(`Строка ${expr.line}: деление на ноль`);
            return bothInts ? Math.trunc(a / b) : a / b;
          case '%':
            if (b === 0) throw new Error(`Строка ${expr.line}: остаток от деления на ноль`);
            return Math.trunc(a) % Math.trunc(b);
          case '<<': return Math.trunc(a) << Math.trunc(b);
          case '>>': return Math.trunc(a) >> Math.trunc(b);
          case '<': return a < b;
          case '<=': return a <= b;
          case '>': return a > b;
          case '>=': return a >= b;
          case '==': return a === b;
          case '!=': return a !== b;
          case '&': return Math.trunc(a) & Math.trunc(b);
          case '^': return Math.trunc(a) ^ Math.trunc(b);
          case '|': return Math.trunc(a) | Math.trunc(b);
          default:
            return 0;
        }
      }
    }
  };

  const execBlock = async (block: BlockStmt, parentScope: Scope, createNew = true): Promise<void> => {
    const scope = createNew ? createScope(parentScope) : parentScope;
    for (const stmt of block.stmts) {
      await execStmt(stmt, scope);
    }
  };

  const execStmt = async (stmt: Stmt, scope: Scope): Promise<void> => {
    await tick();

    switch (stmt.kind) {
      case 'empty':
        return;
      case 'block':
        await execBlock(stmt, scope, true);
        return;
      case 'vardecl':
        for (const item of stmt.items) {
          await declareVarItem(item, scope);
        }
        return;
      case 'expr':
        await evalExpr(stmt.expr, scope);
        return;
      case 'if': {
        const cond = toBool(await evalExpr(stmt.cond, scope));
        if (cond) await execStmt(stmt.thenBranch, scope);
        else if (stmt.elseBranch) await execStmt(stmt.elseBranch, scope);
        return;
      }
      case 'while': {
        while (toBool(await evalExpr(stmt.cond, scope))) {
          try {
            await execStmt(stmt.body, scope);
          } catch (sig) {
            if (sig instanceof BreakSignal) break;
            if (sig instanceof ContinueSignal) continue;
            throw sig;
          }
        }
        return;
      }
      case 'do_while': {
        do {
          try {
            await execStmt(stmt.body, scope);
          } catch (sig) {
            if (sig instanceof BreakSignal) break;
            if (sig instanceof ContinueSignal) continue;
            throw sig;
          }
        } while (toBool(await evalExpr(stmt.cond, scope)));
        return;
      }
      case 'for': {
        const loopScope = createScope(scope);
        if (stmt.init) await execStmt(stmt.init, loopScope);
        while (!stmt.cond || toBool(await evalExpr(stmt.cond, loopScope))) {
          try {
            await execStmt(stmt.body, loopScope);
          } catch (sig) {
            if (sig instanceof BreakSignal) break;
            if (sig instanceof ContinueSignal) {
              if (stmt.update) await evalExpr(stmt.update, loopScope);
              continue;
            }
            throw sig;
          }
          if (stmt.update) await evalExpr(stmt.update, loopScope);
        }
        return;
      }
      case 'range_for': {
        const iterable = await evalExpr(stmt.iterable, scope);
        let items: Cell[] = [];
        if (isVec(iterable)) {
          items = iterable.cells;
        } else if (typeof iterable === 'string') {
          items = Array.from(iterable, (ch) => ({ type: defaultType('char'), value: ch }));
        } else if (isPtr(iterable) && iterable.blockId !== 0) {
          const blk = blocks.get(iterable.blockId);
          if (blk) items = blk.cells.slice(iterable.offset);
        }
        for (const itemCell of items) {
          const iterScope = createScope(scope);
          if (stmt.varType.isRef) {
            iterScope.vars.set(stmt.varName, itemCell);
          } else {
            iterScope.vars.set(stmt.varName, {
              type: stmt.varType.base === 'auto' ? itemCell.type : stmt.varType,
              value: cloneVal(itemCell.value),
            });
          }
          try {
            await execStmt(stmt.body, iterScope);
          } catch (sig) {
            if (sig instanceof BreakSignal) break;
            if (sig instanceof ContinueSignal) continue;
            throw sig;
          }
        }
        return;
      }
      case 'switch': {
        const targetVal = await evalExpr(stmt.discriminant, scope);
        let matchedIdx = -1;
        let defaultIdx = -1;
        for (let i = 0; i < stmt.cases.length; i++) {
          const c = stmt.cases[i];
          if (c.test === null) {
            defaultIdx = i;
          } else {
            const caseVal = await evalExpr(c.test, scope);
            if (toNumber(caseVal) === toNumber(targetVal) || caseVal === targetVal) {
              matchedIdx = i;
              break;
            }
          }
        }
        const startIdx = matchedIdx !== -1 ? matchedIdx : defaultIdx;
        if (startIdx !== -1) {
          const switchScope = createScope(scope);
          try {
            for (let i = startIdx; i < stmt.cases.length; i++) {
              for (const s of stmt.cases[i].stmts) {
                await execStmt(s, switchScope);
              }
            }
          } catch (sig) {
            if (!(sig instanceof BreakSignal)) throw sig;
          }
        }
        return;
      }
      case 'return': {
        const val = stmt.value ? await evalExpr(stmt.value, scope) : undefined;
        throw new ReturnSignal(val);
      }
      case 'break':
        throw new BreakSignal();
      case 'continue':
        throw new ContinueSignal();
    }
  };

  // Register top-level structs, functions, and globals
  const globalScope = createScope(null);

  for (const decl of program.declarations) {
    if (decl.kind === 'struct') {
      structs.set(decl.name, decl);
    } else if (decl.kind === 'function') {
      const list = functions.get(decl.name) ?? [];
      list.push(decl);
      functions.set(decl.name, list);
    }
  }

  for (const decl of program.declarations) {
    if (decl.kind === 'vardecl') {
      for (const item of decl.items) {
        await declareVarItem(item, globalScope);
      }
    }
  }

  const mainCandidates = functions.get('main');
  const mainFn = mainCandidates?.find((f) => f.body);
  if (!mainFn) {
    throw new Error("undefined reference to 'main'");
  }

  const exitResult = await invokeUserFunction(mainFn, [], globalScope);
  return typeof exitResult === 'number' ? Math.trunc(exitResult) : 0;
}
