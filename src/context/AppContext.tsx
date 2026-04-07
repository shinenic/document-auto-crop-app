"use client";

import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type {
  AppState,
  EditState,
  FilterConfig,
  ImageEntry,
  QuadResult,
} from "../lib/types";
import { DEFAULT_FILTER_CONFIG } from "../lib/types";
import { cloneEraseMask } from "../lib/eraser";

// ─── Actions ────────────────────────────────────────────────────────────────

export type AppAction =
  | { type: "SET_SCREEN"; screen: "upload" | "editor" }
  | { type: "ADD_IMAGE"; entry: ImageEntry }
  | { type: "UPDATE_IMAGE"; id: string; updates: Partial<ImageEntry> }
  | { type: "REMOVE_IMAGE"; id: string }
  | { type: "SELECT_IMAGE"; id: string | null }
  | { type: "SET_EDIT_STATE"; id: string; editState: EditState | null }
  | { type: "PUSH_HISTORY"; id: string }
  | { type: "UNDO"; id: string }
  | { type: "REDO"; id: string }
  | { type: "RESET_TO_PREDICTION"; id: string }
  | { type: "CANCEL_CROP"; id: string }
  | { type: "REORDER_IMAGES"; orderedIds: string[] }
  | { type: "BATCH_ROTATE"; rotation: 0 | 90 | 180 | 270 }
  | { type: "BATCH_SET_FILTER"; filterConfig: FilterConfig }
  | { type: "MODEL_LOADING" }
  | { type: "MODEL_LOADED" }
  | { type: "TOGGLE_MASK" }
  | { type: "LOAD_DRAFT"; images: ImageEntry[]; showMask: boolean };

// ─── Helpers ────────────────────────────────────────────────────────────────

function cloneEditState(s: EditState): EditState {
  return {
    corners: s.corners.map((c) => [...c] as [number, number]),
    edgeFits: s.edgeFits.map((f) => ({
      cp1: [...f.cp1] as [number, number],
      cp2: [...f.cp2] as [number, number],
      isArc: f.isArc,
    })),
    rotation: s.rotation,
    filterConfig: {
      type: s.filterConfig.type,
      binarize: { ...s.filterConfig.binarize },
    },
    eraseMask: s.eraseMask ? cloneEraseMask(s.eraseMask) : null,
  };
}

export function editStateFromQuad(quad: QuadResult): EditState {
  return {
    corners: quad.corners.map((c) => [...c] as [number, number]),
    edgeFits: quad.edgeFits.map((f) => ({
      cp1: [...f.cp1] as [number, number],
      cp2: [...f.cp2] as [number, number],
      isArc: f.isArc,
    })),
    rotation: 0,
    filterConfig: {
      type: DEFAULT_FILTER_CONFIG.type,
      binarize: { ...DEFAULT_FILTER_CONFIG.binarize },
    },
    eraseMask: null,
  };
}

// ─── Reducer ────────────────────────────────────────────────────────────────

const MAX_HISTORY = 50;

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_SCREEN":
      return { ...state, screen: action.screen };

    case "ADD_IMAGE":
      return { ...state, images: [...state.images, action.entry] };

    case "UPDATE_IMAGE":
      return {
        ...state,
        images: state.images.map((img) =>
          img.id === action.id ? { ...img, ...action.updates } : img,
        ),
      };

    case "REMOVE_IMAGE": {
      const images = state.images.filter((img) => img.id !== action.id);
      const selectedImageId =
        state.selectedImageId === action.id
          ? (images[0]?.id ?? null)
          : state.selectedImageId;
      return { ...state, images, selectedImageId };
    }

    case "SELECT_IMAGE":
      return { ...state, selectedImageId: action.id };

    case "SET_EDIT_STATE": {
      return {
        ...state,
        images: state.images.map((img) => {
          if (img.id !== action.id) return img;
          let editState = action.editState;
          // Auto-clear eraseMask when binarize params change
          if (editState && img.editState && editState.eraseMask) {
            const oldB = img.editState.filterConfig.binarize;
            const newB = editState.filterConfig.binarize;
            if (
              oldB.blockRadiusBps !== newB.blockRadiusBps ||
              oldB.contrastOffset !== newB.contrastOffset ||
              oldB.upsamplingScale !== newB.upsamplingScale
            ) {
              editState = { ...editState, eraseMask: null };
            }
          }
          return { ...img, editState };
        }),
      };
    }

    case "PUSH_HISTORY":
      return {
        ...state,
        images: state.images.map((img) => {
          if (img.id !== action.id || !img.editState) return img;
          const past = [
            ...img.history.past,
            cloneEditState(img.editState),
          ];
          if (past.length > MAX_HISTORY) past.shift();
          return { ...img, history: { past, future: [] } };
        }),
      };

    case "UNDO":
      return {
        ...state,
        images: state.images.map((img) => {
          if (img.id !== action.id || img.history.past.length === 0)
            return img;
          const past = [...img.history.past];
          const prev = past.pop()!;
          const future = img.editState
            ? [cloneEditState(img.editState), ...img.history.future]
            : img.history.future;
          return { ...img, editState: prev, history: { past, future } };
        }),
      };

    case "REDO":
      return {
        ...state,
        images: state.images.map((img) => {
          if (img.id !== action.id || img.history.future.length === 0)
            return img;
          const future = [...img.history.future];
          const next = future.shift()!;
          const past = img.editState
            ? [...img.history.past, cloneEditState(img.editState)]
            : img.history.past;
          return { ...img, editState: next, history: { past, future } };
        }),
      };

    case "RESET_TO_PREDICTION":
      return {
        ...state,
        images: state.images.map((img) => {
          if (img.id !== action.id || !img.initialQuad) return img;
          const past = img.editState
            ? [...img.history.past, cloneEditState(img.editState)]
            : img.history.past;
          return {
            ...img,
            editState: editStateFromQuad(img.initialQuad),
            history: { past, future: [] },
          };
        }),
      };

    case "CANCEL_CROP":
      return {
        ...state,
        images: state.images.map((img) => {
          if (img.id !== action.id) return img;
          const past = img.editState
            ? [...img.history.past, cloneEditState(img.editState)]
            : img.history.past;
          return {
            ...img,
            editState: null,
            cropCanvas: null,
            filteredCanvas: null,
            history: { past, future: [] },
          };
        }),
      };

    case "REORDER_IMAGES": {
      const idOrder = new Map(action.orderedIds.map((id, i) => [id, i]));
      const images = [...state.images].sort(
        (a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0),
      );
      return { ...state, images };
    }

    case "BATCH_ROTATE": {
      const delta = action.rotation;
      return {
        ...state,
        images: state.images.map((img) => {
          if (!img.editState) return img;
          const past = [
            ...img.history.past,
            cloneEditState(img.editState),
          ];
          if (past.length > MAX_HISTORY) past.shift();
          return {
            ...img,
            editState: {
              ...img.editState,
              rotation: ((img.editState.rotation + delta) % 360) as 0 | 90 | 180 | 270,
            },
            history: { past, future: [] },
          };
        }),
      };
    }

    case "BATCH_SET_FILTER":
      return {
        ...state,
        images: state.images.map((img) => {
          if (!img.editState) return img;
          const past = [
            ...img.history.past,
            cloneEditState(img.editState),
          ];
          if (past.length > MAX_HISTORY) past.shift();
          return {
            ...img,
            editState: {
              ...img.editState,
              filterConfig: {
                type: action.filterConfig.type,
                binarize: { ...action.filterConfig.binarize },
              },
              eraseMask: null,
            },
            history: { past, future: [] },
          };
        }),
      };

    case "MODEL_LOADING":
      return { ...state, modelLoading: true };

    case "MODEL_LOADED":
      return { ...state, modelLoaded: true, modelLoading: false };

    case "TOGGLE_MASK":
      return { ...state, showMask: !state.showMask };

    case "LOAD_DRAFT":
      return {
        ...state,
        screen: "editor",
        images: action.images,
        selectedImageId: action.images[0]?.id ?? null,
        showMask: action.showMask,
      };

    default:
      return state;
  }
}

// ─── Context ────────────────────────────────────────────────────────────────

const initialState: AppState = {
  screen: "upload",
  images: [],
  selectedImageId: null,
  modelLoaded: false,
  modelLoading: false,
  showMask: true,
};

const AppContext = createContext<{
  state: AppState;
  dispatch: Dispatch<AppAction>;
}>({
  state: initialState,
  dispatch: () => {},
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
