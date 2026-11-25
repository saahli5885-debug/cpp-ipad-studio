import type {
  BlockStmt,
  ConstructorDecl,
  Expr,
  FunctionDecl,
  ProgramNode,
  Stmt,
  StructDecl,
  TypeSpec,
  VarDeclItem,
} from './parser';
import {
  CharStreamBuffer,
  createDefaultFormatFlags,
  StreamAbortError,
  type StreamFormatFlags,
} from './streams';

export { StreamAbortError as RuntimeAbortError } from './streams';
export { CharStreamBuffer as InteractiveStdin } from './streams';

export const STRING_NPOS = 4294967295; // 0xFFFFFFFF (unsigned size_t(-1))

export interface Cell {
  value: RuntimeVal;
  type: TypeSpec;
}

export interface CharVal {
  __kind: 'char';
  ch: string;
  code: number;
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

export interface MapEntry {
  key: RuntimeVal;
  cell: Cell;
}

export interface MapVal {
  __kind: 'map';
  ordered: boolean;
  keyType: TypeSpec;
  valType: TypeSpec;
  entries: Map<string, MapEntry>;
}

export interface SetVal {
  __kind: 'set';
  ordered: boolean;
  elemType: TypeSpec;
  items: Map<string, RuntimeVal>;
}

export interface PairVal {
  __kind: 'pair';
  first: Cell;
  second: Cell;
}

export interface StructVal {
  __kind: 'struct';
  structName: string;
  fields: Map<string, Cell>;
}

export interface ExceptionVal {
  __kind: 'exception';
  typeName: string;
  message: string;
}

export type CppStreamKind =
  | 'cin'
  | 'cout'
  | 'cerr'
  | 'istringstream'
  | 'ostringstream'
  | 'stringstream'
  | 'ifstream'
  | 'ofstream'
  | 'fstream';

export interface StreamVal {
  __kind: 'stream';
  streamKind: CppStreamKind;
  buffer: CharStreamBuffer;
  outBuf: string;
  flags: StreamFormatFlags;
  filePath?: string;
  appendMode?: boolean;
  isOpen: boolean;
}

export interface IteratorVal {
  __kind: 'iterator';
  vector: VectorVal;
  index: number;
}

export interface MapIteratorVal {
  __kind: 'map_iter';
  map: MapVal;
  keys: string[];
  index: number; // === keys.length means end()
}

export interface SetIteratorVal {
  __kind: 'set_iter';
  set: SetVal;
  keys: string[];
  index: number;
}

export interface ManipVal {
  __kind: 'manip';
  name:
    | 'endl'
    | 'flush'
    | 'ws'
    | 'fixed'
    | 'scientific'
    | 'defaultfloat'
    | 'setprecision'
    | 'setw'
    | 'setfill'
    | 'left'
    | 'right'
    | 'boolalpha'
    | 'noboolalpha'
    | 'hex'
    | 'dec'
    | 'oct';
  arg?: number | string;
}

export interface BoundFnVal {
  __kind: 'bound_fn';
  fn: (args: RuntimeVal[]) => RuntimeVal;
}

export type RuntimeVal =
  | number
  | string
  | boolean
  | null
  | undefined
  | CharVal
  | PointerVal
  | VectorVal
  | MapVal
  | SetVal
  | PairVal
  | StructVal
  | ExceptionVal
  | StreamVal
  | IteratorVal
  | MapIteratorVal
  | SetIteratorVal
  | ManipVal
  | BoundFnVal;

interface MemoryBlock {
  id: number;
  cells: Cell[];
  elemSize: number;
  baseAddr: number;
  freed: boolean;
}

interface LValue {
  cell: Cell;
  getPtr: () => PointerVal;
  onWrite?: (nextVal: RuntimeVal) => void;
}

const NULL_PTR: PointerVal = {
  __kind: 'ptr',
  blockId: 0,
  offset: 0,
  elemSize: 1,
  baseAddr: 0,
};

function makeChar(input: string | number): CharVal {
  if (typeof input === 'number') {
    const code = Math.trunc(input) & 0xff;
    return { __kind: 'char', ch: String.fromCharCode(code), code };
  }
  const ch = input.length > 0 ? input[0] : '\0';
  return { __kind: 'char', ch, code: ch.charCodeAt(0) };
}

function isChar(v: RuntimeVal): v is CharVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'char';
}
function isPtr(v: RuntimeVal): v is PointerVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'ptr';
}
function isVec(v: RuntimeVal): v is VectorVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'vector';
}
function isMap(v: RuntimeVal): v is MapVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'map';
}
function isSet(v: RuntimeVal): v is SetVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'set';
}
function isPair(v: RuntimeVal): v is PairVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'pair';
}
function isStruct(v: RuntimeVal): v is StructVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'struct';
}
function isException(v: RuntimeVal): v is ExceptionVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'exception';
}
function isStream(v: RuntimeVal): v is StreamVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'stream';
}
function isIterator(v: RuntimeVal): v is IteratorVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'iterator';
}
function isMapIter(v: RuntimeVal): v is MapIteratorVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'map_iter';
}
function isSetIter(v: RuntimeVal): v is SetIteratorVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'set_iter';
}
function isManip(v: RuntimeVal): v is ManipVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'manip';
}
function isBoundFn(v: RuntimeVal): v is BoundFnVal {
  return typeof v === 'object' && v !== null && '__kind' in v && v.__kind === 'bound_fn';
}

export function sizeOfType(t: TypeSpec): number {
  if (t.pointerDepth > 0) return 8;
  switch (t.base) {
    case 'char':
    case 'bool':
    case 'int8_t':
    case 'uint8_t':
      return 1;
    case 'short':
    case 'int16_t':
    case 'uint16_t':
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
    case 'ptrdiff_t':
    case 'streamsize':
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
      t.base === 'ptrdiff_t' ||
      t.base === 'streamsize' ||
      t.base === 'int8_t' ||
      t.base === 'uint8_t' ||
      t.base === 'int16_t' ||
      t.base === 'uint16_t' ||
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
class CppThrowSignal {
  constructor(readonly thrown: RuntimeVal) {}
}

interface Scope {
  parent: Scope | null;
  vars: Map<string, Cell>;
  varPtrs: Map<string, PointerVal>;
  thisObj?: StructVal;
  ownedInOrder: Cell[];
}

export interface RunCallbacks {
  onStdout: (text: string) => void;
  onStderr: (text: string) => void;
  stdin: CharStreamBuffer;
  signal: AbortSignal;
}

const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_CALL_DEPTH = 512;

export async function runProgram(program: ProgramNode, callbacks: RunCallbacks): Promise<number> {
  const { onStdout, onStderr, stdin, signal } = callbacks;

  // Fresh, atomic per-run VM state (zero leakage across runs)
  const functions = new Map<string, FunctionDecl[]>();
  const structs = new Map<string, StructDecl>();
  const enumConsts = new Map<string, number>();
  const blocks = new Map<number, MemoryBlock>();
  const virtualFs = new Map<string, string>();
  const staticVars = new Map<string, Cell>();

  let nextBlockId = 1;
  let nextBaseAddr = 0x55a1400010;
  let outputBytes = 0;
  let stepCounter = 0;
  let callDepth = 0;
  let randSeed = 123456789;

  const cinStream: StreamVal = {
    __kind: 'stream',
    streamKind: 'cin',
    buffer: stdin,
    outBuf: '',
    flags: createDefaultFormatFlags(),
    isOpen: true,
  };
  const coutStream: StreamVal = {
    __kind: 'stream',
    streamKind: 'cout',
    buffer: new CharStreamBuffer({ interactive: false }),
    outBuf: '',
    flags: createDefaultFormatFlags(),
    isOpen: true,
  };
  const cerrStream: StreamVal = {
    __kind: 'stream',
    streamKind: 'cerr',
    buffer: new CharStreamBuffer({ interactive: false }),
    outBuf: '',
    flags: createDefaultFormatFlags(),
    isOpen: true,
  };

  const emit = (target: 'stdout' | 'stderr', text: string) => {
    if (!text) return;
    outputBytes += text.length;
    if (outputBytes > MAX_OUTPUT_BYTES) {
      onStderr('\n[Вывод остановлен: превышен лимит 256 КБ]\n');
      throw new StreamAbortError('Превышен лимит вывода (256 КБ)');
    }
    if (target === 'stdout') onStdout(text);
    else onStderr(text);
  };

  const tick = async () => {
    stepCounter += 1;
    if (stepCounter % 2000 === 0) {
      if (signal.aborted) {
        throw new StreamAbortError('Остановлено пользователем');
      }
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    if (signal.aborted) {
      throw new StreamAbortError('Остановлено пользователем');
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

  const readCStringFromVal = (val: RuntimeVal): string => {
    if (typeof val === 'string') return val;
    if (isChar(val)) return val.ch;
    if (isPtr(val) && val.blockId !== 0) {
      const blk = blocks.get(val.blockId);
      if (!blk) return '';
      let str = '';
      for (let k = val.offset; k < blk.cells.length; k++) {
        const c = blk.cells[k].value;
        if (isChar(c)) {
          if (c.code === 0) break;
          str += c.ch;
        } else if (c === '\0' || c === 0) {
          break;
        } else if (typeof c === 'string') {
          str += c;
        } else {
          str += String.fromCharCode(Number(c) & 0xff);
        }
      }
      return str;
    }
    return String(val ?? '');
  };

  const writeCStringToPtr = (ptr: PointerVal, text: string, maxLen?: number): void => {
    if (ptr.blockId === 0) return;
    const blk = blocks.get(ptr.blockId);
    if (!blk) return;
    const limit = maxLen !== undefined
      ? Math.min(maxLen - 1, blk.cells.length - ptr.offset - 1)
      : blk.cells.length - ptr.offset - 1;
    let written = 0;
    for (let k = 0; k < text.length && written < limit; k++) {
      blk.cells[ptr.offset + written].value = makeChar(text[k]);
      written += 1;
    }
    if (ptr.offset + written < blk.cells.length) {
      blk.cells[ptr.offset + written].value = makeChar('\0');
    }
  };

  const canonicalKey = (val: RuntimeVal): string => {
    if (typeof val === 'string') return `s:${val}`;
    if (typeof val === 'number') return `n:${val}`;
    if (typeof val === 'boolean') return `b:${val ? 1 : 0}`;
    if (isChar(val)) return `c:${val.code}`;
    return `o:${String(val)}`;
  };

  const sortedMapKeys = (map: MapVal): string[] => {
    const arr = Array.from(map.entries.entries());
    if (map.ordered) {
      arr.sort(([, a], [, b]) => {
        if (typeof a.key === 'string' && typeof b.key === 'string') {
          return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
        }
        return toNumber(a.key) - toNumber(b.key);
      });
    }
    return arr.map(([k]) => k);
  };

  const sortedSetKeys = (set: SetVal): string[] => {
    const arr = Array.from(set.items.entries());
    if (set.ordered) {
      arr.sort(([, a], [, b]) => {
        if (typeof a === 'string' && typeof b === 'string') {
          return a < b ? -1 : a > b ? 1 : 0;
        }
        return toNumber(a) - toNumber(b);
      });
    }
    return arr.map(([k]) => k);
  };

  const createStreamObj = (kind: CppStreamKind, initialContent = ''): StreamVal => {
    return {
      __kind: 'stream',
      streamKind: kind,
      buffer: new CharStreamBuffer({ initial: initialContent, interactive: false }),
      outBuf: initialContent,
      flags: createDefaultFormatFlags(),
      isOpen: kind !== 'ifstream' && kind !== 'ofstream' && kind !== 'fstream',
    };
  };

  const openFileStream = (stream: StreamVal, filePath: string, modeBits?: number): void => {
    stream.filePath = filePath;
    const isAppend = modeBits !== undefined && (modeBits & 1) !== 0; // ios::app = 1
    stream.appendMode = isAppend;
    stream.buffer.clear();

    if (stream.streamKind === 'ifstream') {
      if (virtualFs.has(filePath)) {
        stream.buffer.setContent(virtualFs.get(filePath)!);
        stream.isOpen = true;
      } else {
        stream.isOpen = false;
        stream.buffer.failbit = true;
      }
      return;
    }

    if (stream.streamKind === 'ofstream') {
      const existing = isAppend ? (virtualFs.get(filePath) ?? '') : '';
      stream.outBuf = existing;
      virtualFs.set(filePath, existing);
      stream.isOpen = true;
      return;
    }

    // fstream
    const existing = virtualFs.get(filePath) ?? '';
    stream.outBuf = existing;
    stream.buffer.setContent(existing);
    if (!virtualFs.has(filePath)) {
      virtualFs.set(filePath, '');
    }
    stream.isOpen = true;
  };

  const flushAndSyncFileStream = (stream: StreamVal): void => {
    if (
      stream.isOpen &&
      stream.filePath &&
      (stream.streamKind === 'ofstream' || stream.streamKind === 'fstream')
    ) {
      virtualFs.set(stream.filePath, stream.outBuf);
    }
  };

  const closeFileStream = (stream: StreamVal): void => {
    flushAndSyncFileStream(stream);
    stream.isOpen = false;
  };

  const writeToOutputStream = (stream: StreamVal, text: string): void => {
    if (!text) return;
    if (stream.streamKind === 'cout') {
      emit('stdout', text);
      return;
    }
    if (stream.streamKind === 'cerr') {
      emit('stderr', text);
      return;
    }
    if (stream.streamKind === 'ostringstream') {
      stream.outBuf += text;
      return;
    }
    if (stream.streamKind === 'stringstream') {
      stream.outBuf += text;
      stream.buffer.appendContent(text);
      return;
    }
    if (stream.streamKind === 'ofstream' || stream.streamKind === 'fstream') {
      if (!stream.isOpen) {
        stream.buffer.failbit = true;
        return;
      }
      stream.outBuf += text;
      if (stream.streamKind === 'fstream') {
        stream.buffer.appendContent(text);
      }
      flushAndSyncFileStream(stream);
    }
  };

  const defaultValueForType = (type: TypeSpec): RuntimeVal => {
    if (type.pointerDepth > 0) return NULL_PTR;
    if (type.base === 'string') return '';
    if (type.base === 'bool') return false;
    if (type.base === 'char') return makeChar('\0');
    if (type.base === 'vector') {
      const elemType = type.templateArgs?.[0] ?? defaultType('int');
      return { __kind: 'vector', elemType, cells: [] } satisfies VectorVal;
    }
    if (type.base === 'map' || type.base === 'unordered_map') {
      const keyType = type.templateArgs?.[0] ?? defaultType('string');
      const valType = type.templateArgs?.[1] ?? defaultType('double');
      return {
        __kind: 'map',
        ordered: type.base === 'map',
        keyType,
        valType,
        entries: new Map(),
      } satisfies MapVal;
    }
    if (type.base === 'set' || type.base === 'unordered_set') {
      const elemType = type.templateArgs?.[0] ?? defaultType('int');
      return {
        __kind: 'set',
        ordered: type.base === 'set',
        elemType,
        items: new Map(),
      } satisfies SetVal;
    }
    if (type.base === 'pair') {
      const t1 = type.templateArgs?.[0] ?? defaultType('int');
      const t2 = type.templateArgs?.[1] ?? defaultType('int');
      return {
        __kind: 'pair',
        first: { type: t1, value: defaultValueForType(t1) },
        second: { type: t2, value: defaultValueForType(t2) },
      } satisfies PairVal;
    }
    if (
      type.base === 'istringstream' ||
      type.base === 'ostringstream' ||
      type.base === 'stringstream' ||
      type.base === 'ifstream' ||
      type.base === 'ofstream' ||
      type.base === 'fstream'
    ) {
      return createStreamObj(type.base);
    }
    if (
      type.base === 'exception' ||
      type.base === 'runtime_error' ||
      type.base === 'invalid_argument' ||
      type.base === 'out_of_range'
    ) {
      return { __kind: 'exception', typeName: type.base, message: '' } satisfies ExceptionVal;
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

  const cloneVal = (val: RuntimeVal): RuntimeVal => {
    if (isChar(val)) return { ...val };
    if (isVec(val)) {
      return {
        __kind: 'vector',
        elemType: val.elemType,
        cells: val.cells.map((c) => ({ type: c.type, value: cloneVal(c.value) })),
      };
    }
    if (isMap(val)) {
      const entries = new Map<string, MapEntry>();
      for (const [k, e] of val.entries.entries()) {
        entries.set(k, {
          key: cloneVal(e.key),
          cell: { type: e.cell.type, value: cloneVal(e.cell.value) },
        });
      }
      return { ...val, entries };
    }
    if (isSet(val)) {
      const items = new Map<string, RuntimeVal>();
      for (const [k, v] of val.items.entries()) {
        items.set(k, cloneVal(v));
      }
      return { ...val, items };
    }
    if (isPair(val)) {
      return {
        __kind: 'pair',
        first: { type: val.first.type, value: cloneVal(val.first.value) },
        second: { type: val.second.type, value: cloneVal(val.second.value) },
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

  const coerceToType = (val: RuntimeVal, type: TypeSpec): RuntimeVal => {
    if (type.base === 'auto') return cloneVal(val);
    if (type.pointerDepth > 0) {
      if (isPtr(val)) {
        const targetElemSize = sizeOfType({ ...type, pointerDepth: type.pointerDepth - 1 });
        if (val.blockId !== 0 && val.elemSize !== targetElemSize) {
          const blk = blocks.get(val.blockId);
          if (blk && blk.elemSize === 1 && targetElemSize > 1) {
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
      if (isChar(val)) return makeChar(val.code);
      if (typeof val === 'string') return makeChar(val);
      if (typeof val === 'number') return makeChar(val);
      return makeChar('\0');
    }
    if (type.base === 'string') {
      if (typeof val === 'string') return val;
      if (isChar(val)) return val.ch;
      if (isPtr(val)) return readCStringFromVal(val);
      return val === undefined || val === null ? '' : String(val);
    }
    if (isIntType(type)) {
      const num = Math.trunc(toNumber(val));
      if (type.isUnsigned || type.base === 'size_t' || type.base.startsWith('uint')) {
        return num < 0 ? num >>> 0 : num;
      }
      return num;
    }
    if (isFloatType(type)) {
      return toNumber(val);
    }
    return cloneVal(val);
  };

  const toNumber = (val: RuntimeVal): number => {
    if (typeof val === 'number') return val;
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (isChar(val)) return val.code;
    if (typeof val === 'string') return val.length > 0 ? val.charCodeAt(0) : 0;
    if (isPtr(val)) return val.blockId === 0 ? 0 : val.baseAddr + val.offset * val.elemSize;
    if (isStream(val)) return val.isOpen && val.buffer.isOk() ? 1 : 0;
    return 0;
  };

  const toBool = (val: RuntimeVal): boolean => {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    if (isChar(val)) return val.code !== 0;
    if (typeof val === 'string') return val.length > 0 && val !== '\0';
    if (isPtr(val)) return val.blockId !== 0;
    if (isStream(val)) return val.isOpen && val.buffer.isOk();
    return Boolean(val);
  };

  const formatValForStream = (val: RuntimeVal, flags: StreamFormatFlags): string => {
    let str = '';
    if (typeof val === 'boolean') {
      str = flags.boolAlpha ? (val ? 'true' : 'false') : val ? '1' : '0';
    } else if (isChar(val)) {
      str = val.ch;
    } else if (typeof val === 'number') {
      if (Number.isInteger(val) && flags.base !== 10 && !flags.fixed && !flags.scientific) {
        str = (Math.trunc(val) >>> 0).toString(flags.base);
      } else if (flags.fixed) {
        const prec = flags.precision ?? 6;
        str = val.toFixed(prec);
      } else if (flags.scientific) {
        const prec = flags.precision ?? 6;
        str = val.toExponential(prec);
      } else if (flags.precision !== null) {
        str = Number(val.toPrecision(Math.max(1, flags.precision))).toString();
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

    if (flags.width !== null && str.length < flags.width) {
      const pad = flags.fillChar.repeat(flags.width - str.length);
      str = flags.alignLeft ? str + pad : pad + str;
      flags.width = null;
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

      const match = fmt
        .slice(i)
        .match(/^%([-+ 0#]*)(\d+)?(?:\.(\d+))?(?:hh|h|ll|l|z|L)?([diuoxXfFeEgGcsp])/);
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
          if (isChar(arg)) formatted = arg.ch;
          else if (typeof arg === 'string') formatted = arg[0] ?? '';
          else formatted = String.fromCharCode(Math.trunc(toNumber(arg)) & 0xff);
          break;
        case 's':
          formatted = readCStringFromVal(arg);
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

      if (flags.includes('+') && !formatted.startsWith('-') && /[diuoxXfFeEgG]/.test(spec)) {
        formatted = `+${formatted}`;
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

  const executeScanfFromBuffer = async (
    buf: CharStreamBuffer,
    fmt: string,
    args: RuntimeVal[]
  ): Promise<number> => {
    let matched = 0;
    let argIdx = 0;

    for (let i = 0; i < fmt.length; i++) {
      if (/\s/.test(fmt[i])) {
        await buf.skipWhitespace(signal);
        continue;
      }
      if (fmt[i] !== '%') {
        // Literal char match in format string
        const ch = await buf.extractChar(false, signal);
        if (ch === null) return matched === 0 ? -1 : matched;
        if (ch !== fmt[i]) {
          buf.putback(ch);
          return matched;
        }
        continue;
      }
      if (fmt[i + 1] === '%') {
        i += 1;
        continue;
      }

      const match = fmt.slice(i).match(/^%(?:\d+)?(?:hh|h|ll|l|L)?([diuoxXfFeEgGcs])/);
      if (!match) continue;
      const [full, spec] = match;
      const prevIdx = i - 1;
      i += full.length - 1;

      const target = args[argIdx++];
      if (!isPtr(target)) {
        throw new Error('scanf ожидает указатель (например, &x или arr + i)');
      }
      const cell = derefPtr(target);

      // Clear failbit from unrelated prior attempts only if buffer still has data
      if (spec === 'c') {
        const skipWs = prevIdx >= 0 && /\s/.test(fmt[prevIdx]);
        const ch = await buf.extractChar(skipWs, signal);
        if (ch === null) return matched === 0 ? -1 : matched;
        cell.value = makeChar(ch);
        matched += 1;
        continue;
      }

      if (spec === 's') {
        const word = await buf.extractWord(signal);
        if (word === null) return matched === 0 ? -1 : matched;
        if (cell.type.base === 'char' && target.blockId !== 0) {
          writeCStringToPtr(target, word);
        } else {
          cell.value = word;
        }
        matched += 1;
        continue;
      }

      if (spec === 'd' || spec === 'i' || spec === 'u' || spec === 'x' || spec === 'X' || spec === 'o') {
        const radix: 8 | 10 | 16 = spec === 'x' || spec === 'X' ? 16 : spec === 'o' ? 8 : 10;
        const num = await buf.extractNumber(false, radix, signal);
        if (num === null) {
          return buf.eof() && matched === 0 ? -1 : matched;
        }
        cell.value = Math.trunc(num);
        matched += 1;
        continue;
      }

      // Floating-point (%f, %lf, %e, %g)
      const num = await buf.extractNumber(true, 10, signal);
      if (num === null) {
        return buf.eof() && matched === 0 ? -1 : matched;
      }
      cell.value = num;
      matched += 1;
    }

    return matched;
  };

  const readIntoCellFromStream = async (stream: StreamVal, lv: LValue): Promise<void> => {
    const buf = stream.buffer;
    if (!stream.isOpen || buf.fail()) return;

    const { cell } = lv;
    const assignValue = (v: RuntimeVal) => {
      cell.value = v;
      lv.onWrite?.(v);
    };

    if (cell.type.base === 'char' && cell.type.pointerDepth === 0) {
      const ch = await buf.extractChar(true, signal);
      if (ch !== null) assignValue(makeChar(ch));
      return;
    }

    if (cell.type.base === 'string') {
      const word = await buf.extractWord(signal);
      if (word !== null) assignValue(word);
      return;
    }

    if (cell.type.base === 'bool') {
      const word = await buf.extractWord(signal);
      if (word !== null) {
        assignValue(word !== '0' && word.toLowerCase() !== 'false');
      }
      return;
    }

    if (isIntType(cell.type)) {
      const num = await buf.extractNumber(false, stream.flags.base, signal);
      if (num !== null) assignValue(coerceToType(num, cell.type));
      return;
    }

    // Float / double / auto
    const num = await buf.extractNumber(true, 10, signal);
    if (num !== null) assignValue(num);
  };

  const getNumericLimit = (type: TypeSpec, member: string): number => {
    const b = type.base;
    const u = Boolean(type.isUnsigned) || b === 'size_t' || b.startsWith('uint');
    if (b === 'double' || b === 'float') {
      if (member === 'max') return Number.MAX_VALUE;
      if (member === 'min') return Number.MIN_VALUE;
      if (member === 'lowest') return -Number.MAX_VALUE;
      if (member === 'epsilon') return Number.EPSILON;
      if (member === 'infinity') return Infinity;
      return 0;
    }
    if (b === 'int' || b === 'int32_t') {
      if (member === 'max') return u ? 4294967295 : 2147483647;
      if (member === 'min' || member === 'lowest') return u ? 0 : -2147483648;
      return 0;
    }
    if (b === 'short' || b === 'int16_t' || b === 'uint16_t') {
      if (member === 'max') return u ? 65535 : 32767;
      if (member === 'min' || member === 'lowest') return u ? 0 : -32768;
      return 0;
    }
    if (b === 'char' || b === 'int8_t' || b === 'uint8_t') {
      if (member === 'max') return u ? 255 : 127;
      if (member === 'min' || member === 'lowest') return u ? 0 : -128;
      return 0;
    }
    // streamsize, long, long long, size_t, int64_t, uint64_t
    if (member === 'max') return Number.MAX_SAFE_INTEGER;
    if (member === 'min' || member === 'lowest') return u ? 0 : -Number.MAX_SAFE_INTEGER;
    return 0;
  };

  const createScope = (parent: Scope | null, thisObj?: StructVal): Scope => ({
    parent,
    vars: new Map(),
    varPtrs: new Map(),
    thisObj: thisObj ?? parent?.thisObj,
    ownedInOrder: [],
  });

  const destroyScope = async (scope: Scope): Promise<void> => {
    for (let i = scope.ownedInOrder.length - 1; i >= 0; i--) {
      const cell = scope.ownedInOrder[i];
      const val = cell.value;
      if (isStream(val) && (val.streamKind === 'ofstream' || val.streamKind === 'fstream')) {
        closeFileStream(val);
      } else if (isStruct(val)) {
        const decl = structs.get(val.structName);
        if (decl?.destructor && decl.destructor.body) {
          await invokeUserFunction(decl.destructor, [], scope, val);
        }
      }
    }
  };

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

  const resolveLValue = async (expr: Expr, scope: Scope): Promise<LValue> => {
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
      if (isMapIter(ptrVal)) {
        const key = ptrVal.keys[ptrVal.index];
        const entry = key !== undefined ? ptrVal.map.entries.get(key) : undefined;
        if (!entry) throw new Error(`Строка ${expr.line}: разыменование итератора end()`);
        const pair: PairVal = {
          __kind: 'pair',
          first: { type: ptrVal.map.keyType, value: entry.key },
          second: entry.cell,
        };
        const cell: Cell = { type: defaultType('pair'), value: pair };
        return { cell, getPtr: () => allocBlock([cell], 8) };
      }
      if (isIterator(ptrVal)) {
        const cell = ptrVal.vector.cells[ptrVal.index];
        if (!cell) throw new Error(`Строка ${expr.line}: разыменование итератора вне диапазона`);
        return { cell, getPtr: () => allocBlock([cell], sizeOfType(cell.type)) };
      }
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
      if (isMap(target)) {
        const rawKey = await evalExpr(expr.index, scope);
        const keyVal = coerceToType(rawKey, target.keyType);
        const k = canonicalKey(keyVal);
        let entry = target.entries.get(k);
        if (!entry) {
          entry = {
            key: keyVal,
            cell: { type: target.valType, value: defaultValueForType(target.valType) },
          };
          target.entries.set(k, entry);
        }
        return {
          cell: entry.cell,
          getPtr: () => allocBlock([entry!.cell], sizeOfType(entry!.cell.type)),
        };
      }

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
          throw new Error(
            `Строка ${expr.line}: индекс vector (${idx}) вне диапазона (размер ${target.cells.length})`
          );
        }
        const cell = target.cells[idx];
        return {
          cell,
          getPtr: () => allocBlock([cell], sizeOfType(cell.type)),
        };
      }
      if (typeof target === 'string') {
        const ch = idx >= 0 && idx < target.length ? target[idx] : '\0';
        const cell: Cell = { type: defaultType('char'), value: makeChar(ch) };
        let ownerLv: LValue | null = null;
        try {
          ownerLv = await resolveLValue(expr.target, scope);
        } catch {
          ownerLv = null;
        }
        return {
          cell,
          getPtr: () => allocBlock([cell], 1),
          onWrite: (nextVal) => {
            if (ownerLv && typeof ownerLv.cell.value === 'string' && idx >= 0 && idx < ownerLv.cell.value.length) {
              const replacement = isChar(nextVal)
                ? nextVal.ch
                : typeof nextVal === 'string'
                  ? nextVal[0] ?? '\0'
                  : String.fromCharCode(Math.trunc(toNumber(nextVal)) & 0xff);
              ownerLv.cell.value =
                ownerLv.cell.value.slice(0, idx) + replacement + ownerLv.cell.value.slice(idx + 1);
            }
          },
        };
      }
      throw new Error(`Строка ${expr.line}: индексация применена к неподдерживаемому типу`);
    }

    if (expr.kind === 'member') {
      let base = await evalExpr(expr.target, scope);
      if (expr.isArrow) {
        if (isMapIter(base)) {
          const key = base.keys[base.index];
          const entry = key !== undefined ? base.map.entries.get(key) : undefined;
          if (!entry) throw new Error(`Строка ${expr.line}: обращение к итератору end()`);
          if (expr.prop === 'first') {
            const c: Cell = { type: base.map.keyType, value: entry.key };
            return { cell: c, getPtr: () => allocBlock([c], 8) };
          }
          if (expr.prop === 'second') {
            return { cell: entry.cell, getPtr: () => allocBlock([entry.cell], 8) };
          }
        }
        if (!isPtr(base)) throw new Error(`Строка ${expr.line}: оператор '->' требует указатель`);
        base = derefPtr(base).value;
      }
      if (isPair(base)) {
        if (expr.prop === 'first') {
          return { cell: base.first, getPtr: () => allocBlock([base.first], 8) };
        }
        if (expr.prop === 'second') {
          return { cell: base.second, getPtr: () => allocBlock([base.second], 8) };
        }
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

  const resolveRefArg = async (
    argExpr: Expr,
    callerScope: Scope,
    targetType: TypeSpec
  ): Promise<Cell> => {
    try {
      const lv = await resolveLValue(argExpr, callerScope);
      return lv.cell;
    } catch (err) {
      if (targetType.isConst) {
        const val = await evalExpr(argExpr, callerScope);
        return { type: targetType, value: coerceToType(val, targetType) };
      }
      throw err;
    }
  };

  const constructValueFromArgs = async (
    targetType: TypeSpec,
    args: Expr[],
    callerScope: Scope
  ): Promise<RuntimeVal> => {
    // Built-in STL types
    if (targetType.base === 'string') {
      if (args.length === 0) return '';
      if (args.length === 1) {
        const v = await evalExpr(args[0], callerScope);
        return readCStringFromVal(v);
      }
      if (args.length === 2) {
        const first = await evalExpr(args[0], callerScope);
        const second = await evalExpr(args[1], callerScope);
        if (typeof first === 'number') {
          const count = Math.max(0, Math.trunc(first));
          const ch = isChar(second) ? second.ch : String(second)[0] ?? '';
          return ch.repeat(count);
        }
        return readCStringFromVal(first).slice(0, Math.max(0, Math.trunc(toNumber(second))));
      }
      return '';
    }

    if (targetType.base === 'vector') {
      const elemType = targetType.templateArgs?.[0] ?? defaultType('int');
      if (args.length === 0) return { __kind: 'vector', elemType, cells: [] } satisfies VectorVal;
      const firstVal = await evalExpr(args[0], callerScope);
      if (isVec(firstVal) && args.length === 1) {
        return cloneVal(firstVal);
      }
      const count = Math.max(0, Math.trunc(toNumber(firstVal)));
      const fillVal =
        args.length > 1
          ? coerceToType(await evalExpr(args[1], callerScope), elemType)
          : defaultValueForType(elemType);
      return {
        __kind: 'vector',
        elemType,
        cells: Array.from({ length: count }, () => ({ type: elemType, value: cloneVal(fillVal) })),
      } satisfies VectorVal;
    }

    if (targetType.base === 'pair') {
      const t1 = targetType.templateArgs?.[0] ?? defaultType('auto');
      const t2 = targetType.templateArgs?.[1] ?? defaultType('auto');
      const v1 = args[0] ? coerceToType(await evalExpr(args[0], callerScope), t1) : defaultValueForType(t1);
      const v2 = args[1] ? coerceToType(await evalExpr(args[1], callerScope), t2) : defaultValueForType(t2);
      return {
        __kind: 'pair',
        first: { type: t1, value: v1 },
        second: { type: t2, value: v2 },
      } satisfies PairVal;
    }

    if (
      targetType.base === 'istringstream' ||
      targetType.base === 'ostringstream' ||
      targetType.base === 'stringstream'
    ) {
      const initial = args[0] ? readCStringFromVal(await evalExpr(args[0], callerScope)) : '';
      return createStreamObj(targetType.base, initial);
    }

    if (
      targetType.base === 'ifstream' ||
      targetType.base === 'ofstream' ||
      targetType.base === 'fstream'
    ) {
      const stream = createStreamObj(targetType.base);
      if (args[0]) {
        const path = readCStringFromVal(await evalExpr(args[0], callerScope));
        const mode = args[1] ? Math.trunc(toNumber(await evalExpr(args[1], callerScope))) : undefined;
        openFileStream(stream, path, mode);
      }
      return stream;
    }

    if (
      targetType.base === 'exception' ||
      targetType.base === 'runtime_error' ||
      targetType.base === 'invalid_argument' ||
      targetType.base === 'out_of_range'
    ) {
      const msg = args[0] ? readCStringFromVal(await evalExpr(args[0], callerScope)) : targetType.base;
      return { __kind: 'exception', typeName: targetType.base, message: msg } satisfies ExceptionVal;
    }

    if (structs.has(targetType.base)) {
      return constructStruct(structs.get(targetType.base)!, args, callerScope);
    }

    if (args.length > 0) {
      return coerceToType(await evalExpr(args[0], callerScope), targetType);
    }
    return defaultValueForType(targetType);
  };

  const constructStruct = async (
    decl: StructDecl,
    args: Expr[],
    callerScope: Scope
  ): Promise<StructVal> => {
    const fields = new Map<string, Cell>();
    const instance: StructVal = { __kind: 'struct', structName: decl.name, fields };

    // Pick matching constructor (if any)
    let ctor: ConstructorDecl | undefined;
    if (decl.constructors.length > 0) {
      ctor =
        decl.constructors.find((c) => {
          const minArgs = c.params.filter((p) => !p.defaultValue).length;
          return args.length >= minArgs && args.length <= c.params.length;
        }) ?? decl.constructors[0];
    }

    const ctorScope = createScope(globalScope, instance);
    const initializedFields = new Set<string>();

    if (ctor) {
      for (let i = 0; i < ctor.params.length; i++) {
        const param = ctor.params[i];
        if (i < args.length) {
          if (param.type.isRef) {
            const cell = await resolveRefArg(args[i], callerScope, param.type);
            ctorScope.vars.set(param.name, cell);
          } else {
            const val = await evalExpr(args[i], callerScope);
            ctorScope.vars.set(param.name, {
              type: param.type,
              value: coerceToType(val, param.type),
            });
          }
        } else if (param.defaultValue) {
          const defVal = await evalExpr(param.defaultValue, globalScope);
          ctorScope.vars.set(param.name, {
            type: param.type,
            value: coerceToType(defVal, param.type),
          });
        }
      }

      // Run member initializer list (`: src(s), vars(v), pos(0)`)
      for (const init of ctor.initializers) {
        const fieldDecl = decl.fields.find((f) => f.name === init.field);
        if (!fieldDecl) continue;
        initializedFields.add(fieldDecl.name);

        if (fieldDecl.type.isRef && init.args.length > 0) {
          const refCell = await resolveRefArg(init.args[0], ctorScope, fieldDecl.type);
          fields.set(fieldDecl.name, refCell);
        } else {
          const val = await constructValueFromArgs(fieldDecl.type, init.args, ctorScope);
          fields.set(fieldDecl.name, { type: fieldDecl.type, value: val });
        }
      }
    }

    // Initialize any remaining fields with in-class defaults or zero-defaults
    for (const f of decl.fields) {
      if (initializedFields.has(f.name)) continue;
      if (f.init) {
        const raw = await evalExpr(f.init, ctorScope);
        fields.set(f.name, { type: f.type, value: coerceToType(raw, f.type) });
      } else if (f.ctorArgs) {
        const val = await constructValueFromArgs(f.type, f.ctorArgs, ctorScope);
        fields.set(f.name, { type: f.type, value: val });
      } else {
        fields.set(f.name, { type: f.type, value: defaultValueForType(f.type) });
      }
    }

    // Make fields accessible inside constructor body (without overwriting parameter bindings)
    const bodyScope = createScope(globalScope, instance);
    bodyScope.vars.set('this', {
      type: { base: instance.structName, pointerDepth: 1, isRef: false, isConst: false },
      value: allocBlock([{ type: defaultType(instance.structName), value: instance }], 8),
    });
    for (const [k, c] of fields.entries()) {
      bodyScope.vars.set(k, c);
    }
    for (const [k, c] of ctorScope.vars.entries()) {
      bodyScope.vars.set(k, c);
    }

    if (ctor?.body) {
      try {
        await execBlock(ctor.body, bodyScope, false);
      } catch (sig) {
        if (!(sig instanceof ReturnSignal)) throw sig;
      } finally {
        await destroyScope(bodyScope);
      }
    }

    return instance;
  };

  const declareVarItem = async (item: VarDeclItem, scope: Scope): Promise<void> => {
    // Function-local `static` variables persist across calls within one Run and reset on every new Run
    if (item.type.isStatic && scope !== globalScope) {
      const staticKey = `${item.line}:${item.column}:${item.name}`;
      const existing = staticVars.get(staticKey);
      if (existing) {
        scope.vars.set(item.name, existing);
        return;
      }
      const nonStaticItem: VarDeclItem = { ...item, type: { ...item.type, isStatic: false } };
      await declareVarItem(nonStaticItem, scope);
      const created = scope.vars.get(item.name);
      if (created) staticVars.set(staticKey, created);
      return;
    }

    // Fixed-size array declaration: `int a[5]` or `char buf[64]`
    if (item.arraySizes && item.arraySizes.length > 0) {
      let length = Math.trunc(toNumber(await evalExpr(item.arraySizes[0], scope)));
      const elemType: TypeSpec = { ...item.type };
      const initVals: RuntimeVal[] = [];

      if (item.init?.kind === 'init_list') {
        for (const el of item.init.elements) {
          initVals.push(coerceToType(await evalExpr(el, scope), elemType));
        }
      } else if (item.init?.kind === 'string' && elemType.base === 'char') {
        for (const ch of item.init.value) initVals.push(makeChar(ch));
        initVals.push(makeChar('\0'));
      }

      if (length < 0) length = Math.max(1, initVals.length);
      const cells: Cell[] = Array.from({ length }, (_, idx) => ({
        type: elemType,
        value: idx < initVals.length ? initVals[idx] : defaultValueForType(elemType),
      }));
      const ptr = allocBlock(cells, sizeOfType(elemType));
      const arrType: TypeSpec = { ...elemType, pointerDepth: elemType.pointerDepth + 1 };
      const cell: Cell = { type: arrType, value: ptr };
      scope.vars.set(item.name, cell);
      return;
    }

    // Reference binding: `int& r = x;` or `const std::string& s = ...;`
    if (item.type.isRef && item.init) {
      const targetCell = await resolveRefArg(item.init, scope, item.type);
      scope.vars.set(item.name, targetCell);
      return;
    }

    // STL streams (istringstream, ostringstream, stringstream, ifstream, ofstream, fstream)
    if (
      item.type.pointerDepth === 0 &&
      (item.type.base === 'istringstream' ||
        item.type.base === 'ostringstream' ||
        item.type.base === 'stringstream' ||
        item.type.base === 'ifstream' ||
        item.type.base === 'ofstream' ||
        item.type.base === 'fstream')
    ) {
      const ctorArgs = item.ctorArgs ?? (item.init ? [item.init] : []);
      const streamVal = await constructValueFromArgs(item.type, ctorArgs, scope);
      const cell: Cell = { type: item.type, value: streamVal };
      scope.vars.set(item.name, cell);
      scope.ownedInOrder.push(cell);
      return;
    }

    // STL vector initialization
    if (item.type.base === 'vector' && item.type.pointerDepth === 0) {
      const elemType = item.type.templateArgs?.[0] ?? defaultType('int');
      let vecVal: VectorVal;
      if (item.ctorArgs) {
        vecVal = (await constructValueFromArgs(item.type, item.ctorArgs, scope)) as VectorVal;
      } else if (item.init?.kind === 'init_list') {
        const cells: Cell[] = [];
        for (const el of item.init.elements) {
          cells.push({ type: elemType, value: coerceToType(await evalExpr(el, scope), elemType) });
        }
        vecVal = { __kind: 'vector', elemType, cells };
      } else if (item.init) {
        const val = await evalExpr(item.init, scope);
        vecVal = isVec(val)
          ? (cloneVal(val) as VectorVal)
          : { __kind: 'vector', elemType, cells: [] };
      } else {
        vecVal = { __kind: 'vector', elemType, cells: [] };
      }
      scope.vars.set(item.name, { type: item.type, value: vecVal });
      return;
    }

    // STL map / unordered_map initialization (`std::map<std::string, double> vars = {{"pi", 3.14}};`)
    if (
      (item.type.base === 'map' || item.type.base === 'unordered_map') &&
      item.type.pointerDepth === 0
    ) {
      const mapVal = defaultValueForType(item.type) as MapVal;
      if (item.init?.kind === 'init_list') {
        for (const el of item.init.elements) {
          if (el.kind === 'init_list' && el.elements.length >= 2) {
            const kVal = coerceToType(await evalExpr(el.elements[0], scope), mapVal.keyType);
            const vVal = coerceToType(await evalExpr(el.elements[1], scope), mapVal.valType);
            mapVal.entries.set(canonicalKey(kVal), {
              key: kVal,
              cell: { type: mapVal.valType, value: vVal },
            });
          }
        }
      } else if (item.init) {
        const raw = await evalExpr(item.init, scope);
        if (isMap(raw)) {
          scope.vars.set(item.name, { type: item.type, value: cloneVal(raw) });
          return;
        }
      }
      scope.vars.set(item.name, { type: item.type, value: mapVal });
      return;
    }

    // STL set / unordered_set initialization
    if (
      (item.type.base === 'set' || item.type.base === 'unordered_set') &&
      item.type.pointerDepth === 0
    ) {
      const setVal = defaultValueForType(item.type) as SetVal;
      if (item.init?.kind === 'init_list') {
        for (const el of item.init.elements) {
          const v = coerceToType(await evalExpr(el, scope), setVal.elemType);
          setVal.items.set(canonicalKey(v), v);
        }
      } else if (item.init) {
        const raw = await evalExpr(item.init, scope);
        if (isSet(raw)) {
          scope.vars.set(item.name, { type: item.type, value: cloneVal(raw) });
          return;
        }
      }
      scope.vars.set(item.name, { type: item.type, value: setVal });
      return;
    }

    // User-defined struct/class with constructor or aggregate init
    if (item.type.pointerDepth === 0 && structs.has(item.type.base)) {
      const decl = structs.get(item.type.base)!;
      let structVal: StructVal;
      if (item.ctorArgs) {
        structVal = await constructStruct(decl, item.ctorArgs, scope);
      } else if (item.init?.kind === 'init_list') {
        if (decl.constructors.length > 0) {
          structVal = await constructStruct(decl, item.init.elements, scope);
        } else {
          structVal = await constructStruct(decl, [], scope);
          const fieldEntries = Array.from(structVal.fields.values());
          for (let k = 0; k < item.init.elements.length && k < fieldEntries.length; k++) {
            fieldEntries[k].value = coerceToType(
              await evalExpr(item.init.elements[k], scope),
              fieldEntries[k].type
            );
          }
        }
      } else if (item.init) {
        const raw = await evalExpr(item.init, scope);
        structVal = isStruct(raw) ? (cloneVal(raw) as StructVal) : await constructStruct(decl, [], scope);
      } else {
        structVal = await constructStruct(decl, [], scope);
      }
      const cell: Cell = { type: item.type, value: structVal };
      scope.vars.set(item.name, cell);
      scope.ownedInOrder.push(cell);
      return;
    }

    let value: RuntimeVal;
    let resolvedType = item.type;

    if (item.init) {
      const raw = await evalExpr(item.init, scope);
      if (item.type.base === 'auto') {
        if (typeof raw === 'string') resolvedType = defaultType('string');
        else if (isChar(raw)) resolvedType = defaultType('char');
        else if (typeof raw === 'boolean') resolvedType = defaultType('bool');
        else if (typeof raw === 'number' && !Number.isInteger(raw)) resolvedType = defaultType('double');
        else if (isPtr(raw)) resolvedType = { base: 'int', pointerDepth: 1, isRef: false, isConst: false };
        else if (isVec(raw))
          resolvedType = { base: 'vector', templateArgs: [raw.elemType], pointerDepth: 0, isRef: false, isConst: false };
        else if (isMap(raw))
          resolvedType = { base: 'map', templateArgs: [raw.keyType, raw.valType], pointerDepth: 0, isRef: false, isConst: false };
        else if (isSet(raw))
          resolvedType = { base: 'set', templateArgs: [raw.elemType], pointerDepth: 0, isRef: false, isConst: false };
        else if (isPair(raw))
          resolvedType = { base: 'pair', templateArgs: [raw.first.type, raw.second.type], pointerDepth: 0, isRef: false, isConst: false };
        else if (isStruct(raw)) resolvedType = defaultType(raw.structName);
        else resolvedType = defaultType('int');
      }
      value = coerceToType(raw, resolvedType);
    } else if (item.ctorArgs) {
      value = await constructValueFromArgs(item.type, item.ctorArgs, scope);
    } else {
      value = defaultValueForType(item.type);
    }

    const cell: Cell = { type: resolvedType, value };
    scope.vars.set(item.name, cell);
  };

  const callBuiltinFunction = async (
    name: string,
    args: Expr[],
    scope: Scope
  ): Promise<{ handled: true; value: RuntimeVal } | { handled: false }> => {
    // C stdio (<cstdio>)
    if (name === 'printf') {
      const evalArgs: RuntimeVal[] = [];
      for (const a of args) evalArgs.push(await evalExpr(a, scope));
      const fmt = readCStringFromVal(evalArgs[0] ?? '');
      const text = formatPrintf(fmt, evalArgs.slice(1));
      emit('stdout', text);
      return { handled: true, value: text.length };
    }

    if (name === 'sprintf' || name === 'snprintf') {
      const evalArgs: RuntimeVal[] = [];
      for (const a of args) evalArgs.push(await evalExpr(a, scope));
      const dest = evalArgs[0];
      const maxLen = name === 'snprintf' ? Math.trunc(toNumber(evalArgs[1])) : undefined;
      const fmtIdx = name === 'snprintf' ? 2 : 1;
      const fmt = readCStringFromVal(evalArgs[fmtIdx] ?? '');
      const text = formatPrintf(fmt, evalArgs.slice(fmtIdx + 1));
      if (isPtr(dest)) writeCStringToPtr(dest, text, maxLen);
      return { handled: true, value: text.length };
    }

    if (name === 'scanf') {
      const evalArgs: RuntimeVal[] = [];
      for (const a of args) evalArgs.push(await evalExpr(a, scope));
      const fmt = readCStringFromVal(evalArgs[0] ?? '');
      const count = await executeScanfFromBuffer(cinStream.buffer, fmt, evalArgs.slice(1));
      return { handled: true, value: count };
    }

    if (name === 'sscanf') {
      const evalArgs: RuntimeVal[] = [];
      for (const a of args) evalArgs.push(await evalExpr(a, scope));
      const src = readCStringFromVal(evalArgs[0] ?? '');
      const fmt = readCStringFromVal(evalArgs[1] ?? '');
      const tmpBuf = new CharStreamBuffer({ initial: src, interactive: false });
      const count = await executeScanfFromBuffer(tmpBuf, fmt, evalArgs.slice(2));
      return { handled: true, value: count };
    }

    if (name === 'puts') {
      const val = args[0] ? await evalExpr(args[0], scope) : '';
      emit('stdout', `${readCStringFromVal(val)}\n`);
      return { handled: true, value: 0 };
    }

    if (name === 'putchar') {
      const val = args[0] ? await evalExpr(args[0], scope) : 0;
      const ch = isChar(val)
        ? val.ch
        : typeof val === 'string'
          ? val[0] ?? ''
          : String.fromCharCode(toNumber(val) & 0xff);
      emit('stdout', ch);
      return { handled: true, value: ch.charCodeAt(0) || 0 };
    }

    if (name === 'getchar') {
      const code = await cinStream.buffer.getCharCode(signal);
      return { handled: true, value: code };
    }

    if (name === 'fgets') {
      const dest = args[0] ? await evalExpr(args[0], scope) : NULL_PTR;
      const maxCount = args[1] ? Math.trunc(toNumber(await evalExpr(args[1], scope))) : 0;
      const line = await cinStream.buffer.readFgets(maxCount, signal);
      if (line === null) return { handled: true, value: NULL_PTR };
      if (isPtr(dest)) writeCStringToPtr(dest, line, maxCount);
      return { handled: true, value: dest };
    }

    if (name === 'fflush') {
      return { handled: true, value: 0 };
    }

    // C++ std::getline(stream, str, delim?)
    if (name === 'getline') {
      if (args.length < 2) return { handled: true, value: cinStream };
      const streamVal = await evalExpr(args[0], scope);
      const stream = isStream(streamVal) ? streamVal : cinStream;
      const target = await resolveLValue(args[1], scope);
      let delim = '\n';
      if (args[2]) {
        const dVal = await evalExpr(args[2], scope);
        delim = isChar(dVal) ? dVal.ch : typeof dVal === 'string' ? dVal[0] ?? '\n' : String.fromCharCode(toNumber(dVal));
      }
      const line = await stream.buffer.readLine(signal, delim);
      if (line !== null) {
        target.cell.value = line;
        target.onWrite?.(line);
      }
      return { handled: true, value: stream };
    }

    // <iomanip> manipulators
    if (name === 'setprecision') {
      const n = Math.trunc(toNumber(await evalExpr(args[0], scope)));
      return { handled: true, value: { __kind: 'manip', name: 'setprecision', arg: n } satisfies ManipVal };
    }
    if (name === 'setw') {
      const n = Math.trunc(toNumber(await evalExpr(args[0], scope)));
      return { handled: true, value: { __kind: 'manip', name: 'setw', arg: n } satisfies ManipVal };
    }
    if (name === 'setfill') {
      const v = await evalExpr(args[0], scope);
      const ch = isChar(v) ? v.ch : String(v)[0] ?? ' ';
      return { handled: true, value: { __kind: 'manip', name: 'setfill', arg: ch } satisfies ManipVal };
    }

    // Memory allocation
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
        value: makeChar('\0'),
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

    // <algorithm> & <utility>
    if (name === 'make_pair') {
      const v1 = await evalExpr(args[0], scope);
      const v2 = await evalExpr(args[1], scope);
      return {
        handled: true,
        value: {
          __kind: 'pair',
          first: { type: defaultType('auto'), value: cloneVal(v1) },
          second: { type: defaultType('auto'), value: cloneVal(v2) },
        } satisfies PairVal,
      };
    }

    if (name === 'sort') {
      const first = await evalExpr(args[0], scope);
      const last = await evalExpr(args[1], scope);
      if (isIterator(first) && isIterator(last) && first.vector === last.vector) {
        const slice = first.vector.cells.slice(first.index, last.index);
        slice.sort((a, b) => {
          if (typeof a.value === 'string' && typeof b.value === 'string') {
            return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
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
      a.onWrite?.(a.cell.value);
      b.cell.value = tmp;
      b.onWrite?.(b.cell.value);
      return { handled: true, value: undefined };
    }

    if (name === 'min' || name === 'max') {
      const a = await evalExpr(args[0], scope);
      const b = await evalExpr(args[1], scope);
      if (typeof a === 'string' && typeof b === 'string') {
        return { handled: true, value: name === 'min' ? (a < b ? a : b) : a > b ? a : b };
      }
      const na = toNumber(a);
      const nb = toNumber(b);
      return { handled: true, value: name === 'min' ? Math.min(na, nb) : Math.max(na, nb) };
    }

    if (name === 'clamp') {
      const v = toNumber(await evalExpr(args[0], scope));
      const lo = toNumber(await evalExpr(args[1], scope));
      const hi = toNumber(await evalExpr(args[2], scope));
      return { handled: true, value: Math.max(lo, Math.min(hi, v)) };
    }

    // <cctype>
    if (name === 'isspace') {
      const code = Math.trunc(toNumber(await evalExpr(args[0], scope)));
      const ch = String.fromCharCode(code & 0xff);
      return { handled: true, value: (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\v' || ch === '\f') ? 1 : 0 };
    }
    if (name === 'isdigit') {
      const code = Math.trunc(toNumber(await evalExpr(args[0], scope)));
      return { handled: true, value: code >= 48 && code <= 57 ? 1 : 0 };
    }
    if (name === 'isalpha') {
      const code = Math.trunc(toNumber(await evalExpr(args[0], scope)));
      return { handled: true, value: (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ? 1 : 0 };
    }
    if (name === 'isalnum') {
      const code = Math.trunc(toNumber(await evalExpr(args[0], scope)));
      return {
        handled: true,
        value: (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ? 1 : 0,
      };
    }
    if (name === 'isupper') {
      const code = Math.trunc(toNumber(await evalExpr(args[0], scope)));
      return { handled: true, value: code >= 65 && code <= 90 ? 1 : 0 };
    }
    if (name === 'islower') {
      const code = Math.trunc(toNumber(await evalExpr(args[0], scope)));
      return { handled: true, value: code >= 97 && code <= 122 ? 1 : 0 };
    }
    if (name === 'isxdigit') {
      const code = Math.trunc(toNumber(await evalExpr(args[0], scope)));
      return {
        handled: true,
        value: (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102) ? 1 : 0,
      };
    }
    if (name === 'tolower') {
      const code = Math.trunc(toNumber(await evalExpr(args[0], scope)));
      return { handled: true, value: code >= 65 && code <= 90 ? code + 32 : code };
    }
    if (name === 'toupper') {
      const code = Math.trunc(toNumber(await evalExpr(args[0], scope)));
      return { handled: true, value: code >= 97 && code <= 122 ? code - 32 : code };
    }

    // <cmath>
    const math1: Record<string, (x: number) => number> = {
      sqrt: Math.sqrt,
      cbrt: Math.cbrt,
      abs: Math.abs,
      fabs: Math.abs,
      llabs: Math.abs,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      asin: Math.asin,
      acos: Math.acos,
      atan: Math.atan,
      sinh: Math.sinh,
      cosh: Math.cosh,
      tanh: Math.tanh,
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
      trunc: Math.trunc,
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
    if (name === 'atan2') {
      const y = toNumber(await evalExpr(args[0], scope));
      const x = toNumber(await evalExpr(args[1], scope));
      return { handled: true, value: Math.atan2(y, x) };
    }
    if (name === 'hypot') {
      const a = toNumber(await evalExpr(args[0], scope));
      const b = toNumber(await evalExpr(args[1], scope));
      return { handled: true, value: Math.hypot(a, b) };
    }
    if (name === 'isnan') {
      return { handled: true, value: Number.isNaN(toNumber(await evalExpr(args[0], scope))) };
    }
    if (name === 'isinf') {
      const x = toNumber(await evalExpr(args[0], scope));
      return { handled: true, value: !Number.isFinite(x) && !Number.isNaN(x) };
    }
    if (name === 'isfinite') {
      return { handled: true, value: Number.isFinite(toNumber(await evalExpr(args[0], scope))) };
    }

    // <cstring> & <string> numeric conversions
    if (name === 'strlen') {
      return { handled: true, value: readCStringFromVal(await evalExpr(args[0], scope)).length };
    }
    if (name === 'strcmp') {
      const a = readCStringFromVal(await evalExpr(args[0], scope));
      const b = readCStringFromVal(await evalExpr(args[1], scope));
      return { handled: true, value: a < b ? -1 : a > b ? 1 : 0 };
    }
    if (name === 'to_string') {
      const v = await evalExpr(args[0], scope);
      return { handled: true, value: formatValForStream(v, createDefaultFormatFlags()) };
    }
    if (name === 'stoi' || name === 'stol' || name === 'stoll' || name === 'stoul' || name === 'stoull') {
      const str = readCStringFromVal(await evalExpr(args[0], scope));
      const posPtr = args[1] ? await evalExpr(args[1], scope) : NULL_PTR;
      const base = args[2] ? Math.trunc(toNumber(await evalExpr(args[2], scope))) : 10;
      const m = str.match(/^\s*([+-]?(?:0[xX][0-9a-fA-F]+|[0-9a-zA-Z]+))/);
      if (!m) {
        throw new CppThrowSignal({
          __kind: 'exception',
          typeName: 'invalid_argument',
          message: `${name}: invalid numeric string '${str}'`,
        } satisfies ExceptionVal);
      }
      const parsed = Number.parseInt(m[1], base);
      if (Number.isNaN(parsed)) {
        throw new CppThrowSignal({
          __kind: 'exception',
          typeName: 'invalid_argument',
          message: `${name}: invalid numeric string '${str}'`,
        } satisfies ExceptionVal);
      }
      if (isPtr(posPtr) && posPtr.blockId !== 0) {
        derefPtr(posPtr).value = m[0].length;
      }
      return { handled: true, value: parsed };
    }
    if (name === 'stod' || name === 'stof' || name === 'stold') {
      const str = readCStringFromVal(await evalExpr(args[0], scope));
      const posPtr = args[1] ? await evalExpr(args[1], scope) : NULL_PTR;
      const m = str.match(/^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/);
      if (!m) {
        throw new CppThrowSignal({
          __kind: 'exception',
          typeName: 'invalid_argument',
          message: `${name}: invalid floating-point string '${str}'`,
        } satisfies ExceptionVal);
      }
      const parsed = Number(m[1]);
      if (Number.isNaN(parsed)) {
        throw new CppThrowSignal({
          __kind: 'exception',
          typeName: 'invalid_argument',
          message: `${name}: invalid floating-point string '${str}'`,
        } satisfies ExceptionVal);
      }
      if (isPtr(posPtr) && posPtr.blockId !== 0) {
        derefPtr(posPtr).value = m[0].length;
      }
      return { handled: true, value: parsed };
    }
    if (name === 'atoi' || name === 'atol' || name === 'atoll') {
      return { handled: true, value: Number.parseInt(readCStringFromVal(await evalExpr(args[0], scope)), 10) || 0 };
    }
    if (name === 'atof') {
      return { handled: true, value: Number.parseFloat(readCStringFromVal(await evalExpr(args[0], scope))) || 0 };
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

    // Direct struct/class temporary constructor call: `Parser(expr, vars)`
    if (structs.has(name)) {
      const constructed = await constructStruct(structs.get(name)!, args, scope);
      return { handled: true, value: constructed };
    }

    return { handled: false };
  };

  const invokeUserFunction = async (
    decl: FunctionDecl,
    args: Expr[],
    callerScope: Scope,
    thisObj?: StructVal
  ): Promise<RuntimeVal> => {
    callDepth += 1;
    if (callDepth > MAX_CALL_DEPTH) {
      callDepth -= 1;
      throw new Error(`Stack overflow: превышена максимальная глубина рекурсии (${MAX_CALL_DEPTH})`);
    }

    const fnScope = createScope(globalScope, thisObj);

    try {
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
            const cell = await resolveRefArg(args[i], callerScope, param.type);
            fnScope.vars.set(param.name, cell);
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
    } finally {
      await destroyScope(fnScope);
      callDepth -= 1;
    }
  };

  const evalExpr = async (expr: Expr, scope: Scope): Promise<RuntimeVal> => {
    await tick();

    switch (expr.kind) {
      case 'number':
        return expr.value;
      case 'string':
        return expr.value;
      case 'char':
        return makeChar(expr.value);
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

      case 'scoped_template': {
        if (expr.base === 'numeric_limits') {
          const targetType = expr.templateArgs[0] ?? defaultType('int');
          const limitVal = getNumericLimit(targetType, expr.member);
          return {
            __kind: 'bound_fn',
            fn: () => limitVal,
          } satisfies BoundFnVal;
        }
        throw new Error(`Строка ${expr.line}: неподдерживаемый шаблон '${expr.base}::${expr.member}'`);
      }

      case 'type_construct': {
        return constructValueFromArgs(expr.targetType, expr.args, scope);
      }

      case 'ident': {
        // Lexical scope (locals, params, class fields, user globals) always shadows std:: symbols
        const found = lookupCell(scope, expr.name);
        if (found) {
          return found.cell.value;
        }

        if (expr.name === 'cout') return coutStream;
        if (expr.name === 'cerr') return cerrStream;
        if (expr.name === 'cin') return cinStream;
        if (expr.name === 'stdin') return cinStream;
        if (expr.name === 'stdout') return coutStream;
        if (expr.name === 'stderr') return cerrStream;
        if (expr.name === 'EOF') return -1;
        if (expr.name === 'string::npos' || expr.name === 'npos') return STRING_NPOS;
        if (expr.name === 'ios::app' || expr.name === 'ios_base::app') return 1;
        if (expr.name === 'ios::in' || expr.name === 'ios_base::in') return 2;
        if (expr.name === 'ios::out' || expr.name === 'ios_base::out') return 4;
        if (expr.name === 'ios::trunc' || expr.name === 'ios_base::trunc') return 8;

        // Stream manipulators
        if (
          expr.name === 'endl' ||
          expr.name === 'flush' ||
          expr.name === 'ws' ||
          expr.name === 'fixed' ||
          expr.name === 'scientific' ||
          expr.name === 'defaultfloat' ||
          expr.name === 'left' ||
          expr.name === 'right' ||
          expr.name === 'boolalpha' ||
          expr.name === 'noboolalpha' ||
          expr.name === 'hex' ||
          expr.name === 'dec' ||
          expr.name === 'oct'
        ) {
          return { __kind: 'manip', name: expr.name } satisfies ManipVal;
        }

        if (enumConsts.has(expr.name)) {
          return enumConsts.get(expr.name)!;
        }

        throw new Error(`Строка ${expr.line}: необъявленная переменная '${expr.name}'`);
      }

      case 'sizeof': {
        if (expr.targetType) return sizeOfType(expr.targetType);
        if (expr.expr) {
          const val = await evalExpr(expr.expr, scope);
          if (isPtr(val)) return 8;
          if (isChar(val)) return 1;
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
        const initial = await constructValueFromArgs(expr.allocType, expr.args ?? [], scope);
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
          const lv = await resolveLValue(expr, scope);
          return lv.cell.value;
        }
        if (expr.op === '++' || expr.op === '--') {
          const lv = await resolveLValue(expr.arg, scope);
          const delta = expr.op === '++' ? 1 : -1;
          if (isPtr(lv.cell.value)) {
            lv.cell.value = { ...lv.cell.value, offset: lv.cell.value.offset + delta };
          } else if (isIterator(lv.cell.value)) {
            lv.cell.value = { ...lv.cell.value, index: lv.cell.value.index + delta };
          } else if (isMapIter(lv.cell.value)) {
            lv.cell.value = { ...lv.cell.value, index: lv.cell.value.index + delta };
          } else if (isSetIter(lv.cell.value)) {
            lv.cell.value = { ...lv.cell.value, index: lv.cell.value.index + delta };
          } else {
            lv.cell.value = coerceToType(toNumber(lv.cell.value) + delta, lv.cell.type);
          }
          lv.onWrite?.(lv.cell.value);
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
        } else if (isIterator(prev)) {
          lv.cell.value = { ...prev, index: prev.index + delta };
        } else if (isMapIter(prev)) {
          lv.cell.value = { ...prev, index: prev.index + delta };
        } else if (isSetIter(prev)) {
          lv.cell.value = { ...prev, index: prev.index + delta };
        } else {
          lv.cell.value = coerceToType(toNumber(prev) + delta, lv.cell.type);
        }
        lv.onWrite?.(lv.cell.value);
        return prev;
      }

      case 'assign': {
        const lv = await resolveLValue(expr.left, scope);
        const rhs = await evalExpr(expr.right, scope);
        if (expr.op === '=') {
          lv.cell.value = coerceToType(rhs, lv.cell.type);
          lv.onWrite?.(lv.cell.value);
          return lv.cell.value;
        }
        const cur = lv.cell.value;
        if (expr.op === '+=' && typeof cur === 'string') {
          lv.cell.value = cur + (isChar(rhs) ? rhs.ch : readCStringFromVal(rhs));
          lv.onWrite?.(lv.cell.value);
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
        lv.onWrite?.(lv.cell.value);
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
          if (isMapIter(base)) {
            const key = base.keys[base.index];
            const entry = key !== undefined ? base.map.entries.get(key) : undefined;
            if (!entry) throw new Error(`Строка ${expr.line}: обращение к итератору end()`);
            if (expr.prop === 'first') return entry.key;
            if (expr.prop === 'second') return entry.cell.value;
          }
          if (!isPtr(base)) throw new Error(`Строка ${expr.line}: оператор '->' требует указатель`);
          base = derefPtr(base).value;
        }
        if (isPair(base)) {
          if (expr.prop === 'first') return base.first.value;
          if (expr.prop === 'second') return base.second.value;
        }
        if (isStruct(base)) {
          const field = base.fields.get(expr.prop);
          if (field) return field.value;
        }
        return undefined;
      }

      case 'call': {
        // Member method calls: stream.putback(c), vec.push_back(x), map.find(k), str.substr(...), struct.method(...)
        if (expr.callee.kind === 'member') {
          let target = await evalExpr(expr.callee.target, scope);
          if (expr.callee.isArrow && isPtr(target)) {
            target = derefPtr(target).value;
          }
          const method = expr.callee.prop;

          // Stream methods (cin, cout, cerr, istringstream, ostringstream, stringstream, ifstream, ofstream, fstream)
          if (isStream(target)) {
            if (method === 'good') return target.isOpen && target.buffer.good();
            if (method === 'fail') return !target.isOpen || target.buffer.fail();
            if (method === 'eof') return target.buffer.eof();
            if (method === 'bad') return target.buffer.bad();
            if (method === 'clear') {
              target.buffer.clear();
              return undefined;
            }
            if (method === 'flush') {
              flushAndSyncFileStream(target);
              return target;
            }
            if (method === 'is_open') return target.isOpen;
            if (method === 'open') {
              const path = args0Str(await evalAllArgs(expr.args, scope));
              const mode = expr.args[1] ? Math.trunc(toNumber(await evalExpr(expr.args[1], scope))) : undefined;
              openFileStream(target, path, mode);
              return undefined;
            }
            if (method === 'close') {
              closeFileStream(target);
              return undefined;
            }
            if (method === 'str') {
              if (expr.args.length === 0) {
                return target.streamKind === 'istringstream'
                  ? target.buffer.getContent()
                  : target.outBuf;
              }
              const nextStr = readCStringFromVal(await evalExpr(expr.args[0], scope));
              target.outBuf = nextStr;
              target.buffer.setContent(nextStr);
              return undefined;
            }
            if (method === 'peek') {
              return target.buffer.peekChar(signal);
            }
            if (method === 'get') {
              if (expr.args.length === 0) {
                return target.buffer.getCharCode(signal);
              }
              const lv = await resolveLValue(expr.args[0], scope);
              const ch = await target.buffer.extractChar(false, signal);
              if (ch !== null) {
                lv.cell.value = makeChar(ch);
                lv.onWrite?.(lv.cell.value);
              }
              return target;
            }
            if (method === 'putback') {
              const argVal = await evalExpr(expr.args[0], scope);
              const ch = isChar(argVal)
                ? argVal.ch
                : typeof argVal === 'string'
                  ? argVal[0] ?? '\0'
                  : String.fromCharCode(Math.trunc(toNumber(argVal)) & 0xff);
              target.buffer.putback(ch);
              return target;
            }
            if (method === 'unget') {
              target.buffer.unget();
              return target;
            }
            if (method === 'ignore') {
              const count =
                expr.args.length > 0 ? Math.max(0, Math.trunc(toNumber(await evalExpr(expr.args[0], scope)))) : 1;
              let delimCode: number | null = null;
              if (expr.args.length > 1) {
                const dVal = await evalExpr(expr.args[1], scope);
                const code = Math.trunc(toNumber(dVal));
                delimCode = code === -1 ? null : code;
              }
              await target.buffer.ignore(count, delimCode, signal);
              return target;
            }
            if (method === 'getline') {
              const dest = await evalExpr(expr.args[0], scope);
              const maxCount = Math.max(1, Math.trunc(toNumber(await evalExpr(expr.args[1], scope))));
              let delim = '\n';
              if (expr.args[2]) {
                const d = await evalExpr(expr.args[2], scope);
                delim = isChar(d) ? d.ch : String.fromCharCode(toNumber(d));
              }
              const line = await target.buffer.readLine(signal, delim);
              if (line !== null && isPtr(dest)) {
                writeCStringToPtr(dest, line, maxCount);
              }
              return target;
            }
            if (method === 'put') {
              const v = await evalExpr(expr.args[0], scope);
              const ch = isChar(v) ? v.ch : String.fromCharCode(Math.trunc(toNumber(v)) & 0xff);
              writeToOutputStream(target, ch);
              return target;
            }
            if (method === 'tie') {
              return NULL_PTR;
            }
          }

          // Exception .what()
          if (isException(target) && method === 'what') {
            return target.message;
          }

          // Vector methods
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
            if (method === 'at') {
              const idx = Math.trunc(toNumber(await evalExpr(expr.args[0], scope)));
              if (idx < 0 || idx >= target.cells.length) {
                throw new CppThrowSignal({
                  __kind: 'exception',
                  typeName: 'out_of_range',
                  message: `vector::at: индекс ${idx} вне диапазона`,
                } satisfies ExceptionVal);
              }
              return target.cells[idx].value;
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
            if (method === 'reserve' || method === 'shrink_to_fit') {
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

          // Map / Unordered_map methods
          if (isMap(target)) {
            if (method === 'size') return target.entries.size;
            if (method === 'empty') return target.entries.size === 0;
            if (method === 'clear') {
              target.entries.clear();
              return undefined;
            }
            if (method === 'count' || method === 'contains') {
              const k = canonicalKey(coerceToType(await evalExpr(expr.args[0], scope), target.keyType));
              const has = target.entries.has(k);
              return method === 'contains' ? has : has ? 1 : 0;
            }
            if (method === 'erase') {
              const arg = await evalExpr(expr.args[0], scope);
              if (isMapIter(arg)) {
                const k = arg.keys[arg.index];
                if (k !== undefined) target.entries.delete(k);
                return undefined;
              }
              const k = canonicalKey(coerceToType(arg, target.keyType));
              return target.entries.delete(k) ? 1 : 0;
            }
            if (method === 'at') {
              const kVal = coerceToType(await evalExpr(expr.args[0], scope), target.keyType);
              const entry = target.entries.get(canonicalKey(kVal));
              if (!entry) {
                throw new CppThrowSignal({
                  __kind: 'exception',
                  typeName: 'out_of_range',
                  message: `map::at: ключ '${String(kVal)}' не найден`,
                } satisfies ExceptionVal);
              }
              return entry.cell.value;
            }
            if (method === 'find') {
              const k = canonicalKey(coerceToType(await evalExpr(expr.args[0], scope), target.keyType));
              const keys = sortedMapKeys(target);
              const idx = keys.indexOf(k);
              return {
                __kind: 'map_iter',
                map: target,
                keys,
                index: idx === -1 ? keys.length : idx,
              } satisfies MapIteratorVal;
            }
            if (method === 'begin') {
              return { __kind: 'map_iter', map: target, keys: sortedMapKeys(target), index: 0 } satisfies MapIteratorVal;
            }
            if (method === 'end') {
              const keys = sortedMapKeys(target);
              return { __kind: 'map_iter', map: target, keys, index: keys.length } satisfies MapIteratorVal;
            }
            if (method === 'insert' || method === 'emplace') {
              if (expr.args.length === 2) {
                const kVal = coerceToType(await evalExpr(expr.args[0], scope), target.keyType);
                const vVal = coerceToType(await evalExpr(expr.args[1], scope), target.valType);
                const k = canonicalKey(kVal);
                if (!target.entries.has(k)) {
                  target.entries.set(k, { key: kVal, cell: { type: target.valType, value: vVal } });
                }
              } else if (expr.args.length === 1) {
                const arg = await evalExpr(expr.args[0], scope);
                if (isPair(arg)) {
                  const kVal = coerceToType(arg.first.value, target.keyType);
                  const vVal = coerceToType(arg.second.value, target.valType);
                  const k = canonicalKey(kVal);
                  if (!target.entries.has(k)) {
                    target.entries.set(k, { key: kVal, cell: { type: target.valType, value: vVal } });
                  }
                } else if (isVec(arg) && arg.cells.length >= 2) {
                  const kVal = coerceToType(arg.cells[0].value, target.keyType);
                  const vVal = coerceToType(arg.cells[1].value, target.valType);
                  const k = canonicalKey(kVal);
                  if (!target.entries.has(k)) {
                    target.entries.set(k, { key: kVal, cell: { type: target.valType, value: vVal } });
                  }
                }
              }
              return undefined;
            }
          }

          // Set / Unordered_set methods
          if (isSet(target)) {
            if (method === 'size') return target.items.size;
            if (method === 'empty') return target.items.size === 0;
            if (method === 'clear') {
              target.items.clear();
              return undefined;
            }
            if (method === 'insert' || method === 'emplace') {
              const v = coerceToType(await evalExpr(expr.args[0], scope), target.elemType);
              target.items.set(canonicalKey(v), v);
              return undefined;
            }
            if (method === 'erase') {
              const v = coerceToType(await evalExpr(expr.args[0], scope), target.elemType);
              return target.items.delete(canonicalKey(v)) ? 1 : 0;
            }
            if (method === 'count' || method === 'contains') {
              const v = coerceToType(await evalExpr(expr.args[0], scope), target.elemType);
              const has = target.items.has(canonicalKey(v));
              return method === 'contains' ? has : has ? 1 : 0;
            }
            if (method === 'find') {
              const v = coerceToType(await evalExpr(expr.args[0], scope), target.elemType);
              const keys = sortedSetKeys(target);
              const idx = keys.indexOf(canonicalKey(v));
              return { __kind: 'set_iter', set: target, keys, index: idx === -1 ? keys.length : idx } satisfies SetIteratorVal;
            }
            if (method === 'begin') {
              return { __kind: 'set_iter', set: target, keys: sortedSetKeys(target), index: 0 } satisfies SetIteratorVal;
            }
            if (method === 'end') {
              const keys = sortedSetKeys(target);
              return { __kind: 'set_iter', set: target, keys, index: keys.length } satisfies SetIteratorVal;
            }
          }

          // std::string methods (including in-place mutators!)
          if (typeof target === 'string') {
            if (method === 'size' || method === 'length') return target.length;
            if (method === 'empty') return target.length === 0;
            if (method === 'c_str' || method === 'data') return target;
            if (method === 'front') return makeChar(target[0] ?? '\0');
            if (method === 'back') return makeChar(target[target.length - 1] ?? '\0');
            if (method === 'at') {
              const idx = Math.trunc(toNumber(await evalExpr(expr.args[0], scope)));
              if (idx < 0 || idx >= target.length) {
                throw new CppThrowSignal({
                  __kind: 'exception',
                  typeName: 'out_of_range',
                  message: `string::at: индекс ${idx} вне диапазона`,
                } satisfies ExceptionVal);
              }
              return makeChar(target[idx]);
            }
            if (method === 'substr') {
              const start =
                expr.args.length > 0 ? Math.trunc(toNumber(await evalExpr(expr.args[0], scope))) : 0;
              if (start < 0 || start > target.length) {
                throw new CppThrowSignal({
                  __kind: 'exception',
                  typeName: 'out_of_range',
                  message: `string::substr: позиция ${start} вне диапазона`,
                } satisfies ExceptionVal);
              }
              const len =
                expr.args.length > 1
                  ? Math.trunc(toNumber(await evalExpr(expr.args[1], scope)))
                  : target.length - start;
              return target.slice(start, len === STRING_NPOS ? undefined : start + Math.max(0, len));
            }
            if (method === 'find' || method === 'rfind') {
              const needleVal = await evalExpr(expr.args[0], scope);
              const needle = isChar(needleVal) ? needleVal.ch : readCStringFromVal(needleVal);
              const startPos =
                expr.args.length > 1
                  ? Math.trunc(toNumber(await evalExpr(expr.args[1], scope)))
                  : method === 'find'
                    ? 0
                    : target.length;
              const idx = method === 'find' ? target.indexOf(needle, startPos) : target.lastIndexOf(needle, startPos);
              return idx === -1 ? STRING_NPOS : idx;
            }
            if (method === 'starts_with') {
              const prefix = readCStringFromVal(await evalExpr(expr.args[0], scope));
              return target.startsWith(prefix);
            }
            if (method === 'ends_with') {
              const suffix = readCStringFromVal(await evalExpr(expr.args[0], scope));
              return target.endsWith(suffix);
            }
            if (
              method === 'push_back' ||
              method === 'pop_back' ||
              method === 'clear' ||
              method === 'append' ||
              method === 'erase' ||
              method === 'replace'
            ) {
              const lv = await resolveLValue(expr.callee.target, scope);
              let next = target;
              if (method === 'push_back') {
                const cVal = await evalExpr(expr.args[0], scope);
                next += isChar(cVal) ? cVal.ch : String.fromCharCode(toNumber(cVal) & 0xff);
              } else if (method === 'pop_back') {
                next = target.slice(0, -1);
              } else if (method === 'clear') {
                next = '';
              } else if (method === 'append') {
                const sVal = await evalExpr(expr.args[0], scope);
                next += isChar(sVal) ? sVal.ch : readCStringFromVal(sVal);
              } else if (method === 'erase') {
                const start = expr.args[0] ? Math.trunc(toNumber(await evalExpr(expr.args[0], scope))) : 0;
                const count = expr.args[1] ? Math.trunc(toNumber(await evalExpr(expr.args[1], scope))) : target.length;
                next = target.slice(0, start) + target.slice(start + count);
              } else if (method === 'replace') {
                const start = Math.trunc(toNumber(await evalExpr(expr.args[0], scope)));
                const count = Math.trunc(toNumber(await evalExpr(expr.args[1], scope)));
                const repl = readCStringFromVal(await evalExpr(expr.args[2], scope));
                next = target.slice(0, start) + repl + target.slice(start + count);
              }
              lv.cell.value = next;
              lv.onWrite?.(next);
              return method === 'append' || method === 'erase' || method === 'replace' ? next : undefined;
            }
          }

          // User struct/class methods
          if (isStruct(target)) {
            const decl = structs.get(target.structName);
            const fn =
              decl?.methods.find((m) => m.name === method && m.params.length === expr.args.length && m.body) ??
              decl?.methods.find((m) => m.name === method && m.body) ??
              decl?.methods.find((m) => m.name === method);
            if (fn) {
              return invokeUserFunction(fn, expr.args, scope, target);
            }
          }

          throw new Error(`Строка ${expr.line}: неизвестный метод '${method}'`);
        }

        // Direct identifier calls: member methods on `this`, builtins, or free functions
        if (expr.callee.kind === 'ident') {
          const fnName = expr.callee.name;

          // Check implicit `this->method(...)` when executing inside a class method!
          if (scope.thisObj) {
            const decl = structs.get(scope.thisObj.structName);
            const memberFn =
              decl?.methods.find((m) => m.name === fnName && m.params.length === expr.args.length && m.body) ??
              decl?.methods.find((m) => m.name === fnName && m.body);
            if (memberFn) {
              return invokeUserFunction(memberFn, expr.args, scope, scope.thisObj);
            }
          }

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

        // Calls on callable expressions like `(std::numeric_limits<std::streamsize>::max)()`
        const calleeVal = await evalExpr(expr.callee, scope);
        if (isBoundFn(calleeVal)) {
          const evalArgs = await evalAllArgs(expr.args, scope);
          return calleeVal.fn(evalArgs);
        }

        throw new Error(`Строка ${expr.line}: выражение не является вызываемой функцией`);
      }

      case 'binary': {
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

        // Stream output: `cout << ...`, `cerr << ...`, `oss << ...`, `ofs << ...`, `ss << ...`
        if (
          expr.op === '<<' &&
          isStream(leftVal) &&
          (leftVal.streamKind === 'cout' ||
            leftVal.streamKind === 'cerr' ||
            leftVal.streamKind === 'ostringstream' ||
            leftVal.streamKind === 'stringstream' ||
            leftVal.streamKind === 'ofstream' ||
            leftVal.streamKind === 'fstream')
        ) {
          const rightVal = await evalExpr(expr.right, scope);
          if (isManip(rightVal)) {
            switch (rightVal.name) {
              case 'endl':
                writeToOutputStream(leftVal, '\n');
                flushAndSyncFileStream(leftVal);
                break;
              case 'flush':
                flushAndSyncFileStream(leftVal);
                break;
              case 'fixed':
                leftVal.flags.fixed = true;
                leftVal.flags.scientific = false;
                break;
              case 'scientific':
                leftVal.flags.scientific = true;
                leftVal.flags.fixed = false;
                break;
              case 'defaultfloat':
                leftVal.flags.fixed = false;
                leftVal.flags.scientific = false;
                break;
              case 'setprecision':
                leftVal.flags.precision = Number(rightVal.arg ?? 6);
                break;
              case 'setw':
                leftVal.flags.width = Number(rightVal.arg ?? 0);
                break;
              case 'setfill':
                leftVal.flags.fillChar = String(rightVal.arg ?? ' ');
                break;
              case 'left':
                leftVal.flags.alignLeft = true;
                break;
              case 'right':
                leftVal.flags.alignLeft = false;
                break;
              case 'boolalpha':
                leftVal.flags.boolAlpha = true;
                break;
              case 'noboolalpha':
                leftVal.flags.boolAlpha = false;
                break;
              case 'hex':
                leftVal.flags.base = 16;
                break;
              case 'dec':
                leftVal.flags.base = 10;
                break;
              case 'oct':
                leftVal.flags.base = 8;
                break;
            }
          } else {
            writeToOutputStream(leftVal, formatValForStream(rightVal, leftVal.flags));
          }
          return leftVal;
        }

        // Stream input: `cin >> ...`, `iss >> ...`, `ss >> ...`, `ifs >> ...`, `fs >> ...`
        if (
          expr.op === '>>' &&
          isStream(leftVal) &&
          (leftVal.streamKind === 'cin' ||
            leftVal.streamKind === 'istringstream' ||
            leftVal.streamKind === 'stringstream' ||
            leftVal.streamKind === 'ifstream' ||
            leftVal.streamKind === 'fstream')
        ) {
          // Handle `stream >> std::ws` or stream base manipulators (`hex`/`dec`/`oct`)
          if (
            expr.right.kind === 'ident' &&
            (expr.right.name === 'ws' ||
              expr.right.name === 'hex' ||
              expr.right.name === 'dec' ||
              expr.right.name === 'oct')
          ) {
            if (expr.right.name === 'ws') {
              await leftVal.buffer.skipWhitespace(signal);
            } else if (expr.right.name === 'hex') {
              leftVal.flags.base = 16;
            } else if (expr.right.name === 'dec') {
              leftVal.flags.base = 10;
            } else if (expr.right.name === 'oct') {
              leftVal.flags.base = 8;
            }
            return leftVal;
          }

          if (!leftVal.isOpen || leftVal.buffer.fail()) {
            return leftVal;
          }
          const lv = await resolveLValue(expr.right, scope);
          await readIntoCellFromStream(leftVal, lv);
          return leftVal;
        }

        const rightVal = await evalExpr(expr.right, scope);

        // Iterator equality
        if (isMapIter(leftVal) && isMapIter(rightVal)) {
          if (expr.op === '==') return leftVal.map === rightVal.map && leftVal.index === rightVal.index;
          if (expr.op === '!=') return leftVal.map !== rightVal.map || leftVal.index !== rightVal.index;
        }
        if (isSetIter(leftVal) && isSetIter(rightVal)) {
          if (expr.op === '==') return leftVal.set === rightVal.set && leftVal.index === rightVal.index;
          if (expr.op === '!=') return leftVal.set !== rightVal.set || leftVal.index !== rightVal.index;
        }
        if (isIterator(leftVal) && isIterator(rightVal)) {
          if (expr.op === '==') return leftVal.vector === rightVal.vector && leftVal.index === rightVal.index;
          if (expr.op === '!=') return leftVal.vector !== rightVal.vector || leftVal.index !== rightVal.index;
          if (expr.op === '-') return leftVal.index - rightVal.index;
        }

        // Pointer, iterator, and string concatenation arithmetic
        if (expr.op === '+') {
          if (isPtr(leftVal)) {
            if (typeof rightVal === 'string') return readCStringFromVal(leftVal) + rightVal;
            return { ...leftVal, offset: leftVal.offset + Math.trunc(toNumber(rightVal)) } satisfies PointerVal;
          }
          if (isPtr(rightVal)) {
            if (typeof leftVal === 'string') return leftVal + readCStringFromVal(rightVal);
            return { ...rightVal, offset: rightVal.offset + Math.trunc(toNumber(leftVal)) } satisfies PointerVal;
          }
          if (isIterator(leftVal)) {
            return { ...leftVal, index: leftVal.index + Math.trunc(toNumber(rightVal)) } satisfies IteratorVal;
          }
          if (typeof leftVal === 'string' && typeof rightVal === 'string') {
            return leftVal + rightVal;
          }
          if (typeof leftVal === 'string' && isChar(rightVal)) {
            return leftVal + rightVal.ch;
          }
          if (isChar(leftVal) && typeof rightVal === 'string') {
            return leftVal.ch + rightVal;
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

        // std::string comparisons (ALWAYS string comparison, including 1-char strings like "+")
        if (typeof leftVal === 'string' && typeof rightVal === 'string') {
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

  const evalAllArgs = async (args: Expr[], scope: Scope): Promise<RuntimeVal[]> => {
    const out: RuntimeVal[] = [];
    for (const a of args) out.push(await evalExpr(a, scope));
    return out;
  };

  const args0Str = (args: RuntimeVal[]): string => (args[0] !== undefined ? readCStringFromVal(args[0]) : '');

  const execBlock = async (block: BlockStmt, parentScope: Scope, createNew = true): Promise<void> => {
    const scope = createNew ? createScope(parentScope) : parentScope;
    try {
      for (const stmt of block.stmts) {
        await execStmt(stmt, scope);
      }
    } finally {
      if (createNew) {
        await destroyScope(scope);
      }
    }
  };

  const registerEnum = async (decl: Extract<Stmt, { kind: 'enum' }>, scope: Scope): Promise<void> => {
    let nextVal = 0;
    for (const m of decl.members) {
      if (m.value) {
        nextVal = Math.trunc(toNumber(await evalExpr(m.value, scope)));
      }
      if (decl.name) {
        enumConsts.set(`${decl.name}::${m.name}`, nextVal);
      }
      if (!decl.isClass) {
        enumConsts.set(m.name, nextVal);
      }
      nextVal += 1;
    }
  };

  const execStmt = async (stmt: Stmt, scope: Scope): Promise<void> => {
    await tick();

    switch (stmt.kind) {
      case 'empty':
        return;
      case 'enum':
        await registerEnum(stmt, scope);
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
        try {
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
        } finally {
          await destroyScope(loopScope);
        }
        return;
      }
      case 'range_for': {
        const iterable = await evalExpr(stmt.iterable, scope);
        let items: Cell[] = [];
        if (isVec(iterable)) {
          items = iterable.cells;
        } else if (isMap(iterable)) {
          const keys = sortedMapKeys(iterable);
          items = keys.map((k) => {
            const entry = iterable.entries.get(k)!;
            return {
              type: defaultType('pair'),
              value: {
                __kind: 'pair',
                first: { type: iterable.keyType, value: entry.key },
                second: entry.cell,
              } satisfies PairVal,
            };
          });
        } else if (isSet(iterable)) {
          const keys = sortedSetKeys(iterable);
          items = keys.map((k) => ({
            type: iterable.elemType,
            value: iterable.items.get(k)!,
          }));
        } else if (typeof iterable === 'string') {
          items = Array.from(iterable, (ch) => ({ type: defaultType('char'), value: makeChar(ch) }));
        } else if (isPtr(iterable) && iterable.blockId !== 0) {
          const blk = blocks.get(iterable.blockId);
          if (blk) items = blk.cells.slice(iterable.offset);
        }

        for (const itemCell of items) {
          const iterScope = createScope(scope);
          if (stmt.structuredNames && stmt.structuredNames.length >= 2 && isPair(itemCell.value)) {
            iterScope.vars.set(stmt.structuredNames[0], itemCell.value.first);
            iterScope.vars.set(
              stmt.structuredNames[1],
              stmt.varType.isRef
                ? itemCell.value.second
                : { type: itemCell.value.second.type, value: cloneVal(itemCell.value.second.value) }
            );
          } else if (stmt.varType.isRef) {
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
          } finally {
            await destroyScope(iterScope);
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
          } finally {
            await destroyScope(switchScope);
          }
        }
        return;
      }
      case 'try_catch': {
        try {
          await execBlock(stmt.tryBlock, scope, true);
        } catch (err) {
          if (
            err instanceof ReturnSignal ||
            err instanceof BreakSignal ||
            err instanceof ContinueSignal ||
            err instanceof StreamAbortError
          ) {
            throw err;
          }

          const thrownVal: RuntimeVal =
            err instanceof CppThrowSignal
              ? err.thrown
              : ({
                  __kind: 'exception',
                  typeName: 'runtime_error',
                  message: err instanceof Error ? err.message : String(err),
                } satisfies ExceptionVal);

          let caught = false;
          for (const clause of stmt.catches) {
            const matches =
              !clause.paramType ||
              clause.paramType.base === 'exception' ||
              (isException(thrownVal) &&
                (clause.paramType.base === thrownVal.typeName ||
                  clause.paramType.base === 'runtime_error' ||
                  clause.paramType.base === 'exception')) ||
              (typeof thrownVal === 'string' && clause.paramType.base === 'string') ||
              (typeof thrownVal === 'number' && isIntType(clause.paramType));

            if (matches) {
              caught = true;
              const catchScope = createScope(scope);
              if (clause.paramName && clause.paramType) {
                catchScope.vars.set(clause.paramName, {
                  type: clause.paramType,
                  value: thrownVal,
                });
              }
              try {
                await execBlock(clause.body, catchScope, false);
              } finally {
                await destroyScope(catchScope);
              }
              break;
            }
          }
          if (!caught) throw err;
        }
        return;
      }
      case 'throw': {
        const val = stmt.value
          ? await evalExpr(stmt.value, scope)
          : ({ __kind: 'exception', typeName: 'runtime_error', message: 'rethrow' } satisfies ExceptionVal);
        throw new CppThrowSignal(val);
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

  // Register top-level structs, enums, functions, and globals
  const globalScope = createScope(null);

  for (const decl of program.declarations) {
    if (decl.kind === 'struct') {
      structs.set(decl.name, decl);
    } else if (decl.kind === 'function') {
      const list = functions.get(decl.name) ?? [];
      list.push(decl);
      functions.set(decl.name, list);
    } else if (decl.kind === 'enum') {
      await registerEnum(decl, globalScope);
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

  try {
    const exitResult = await invokeUserFunction(mainFn, [], globalScope);
    return typeof exitResult === 'number' ? Math.trunc(exitResult) : 0;
  } catch (err) {
    if (err instanceof CppThrowSignal) {
      const msg = isException(err.thrown) ? err.thrown.message : String(err.thrown);
      throw new Error(`Непойманное исключение: ${msg}`);
    }
    throw err;
  } finally {
    await destroyScope(globalScope);
  }
}
