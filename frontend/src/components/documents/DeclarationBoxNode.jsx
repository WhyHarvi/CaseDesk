import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import { GripHorizontal, Maximize2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

const PAGE_CONTENT_WIDTH = 672;
const PAGE_CONTENT_HEIGHT = 880;
const MIN_WIDTH = 160;
const MIN_HEIGHT = 48;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function DeclarationBoxView({
  node,
  selected,
  updateAttributes,
  deleteNode,
  editor,
}) {
  const interactionRef = useRef(null);
  const updateAttributesRef = useRef(updateAttributes);
  updateAttributesRef.current = updateAttributes;

  const handlePointerMove = useCallback(
    (event) => {
      const interaction = interactionRef.current;
      if (!interaction) return;
      event.preventDefault();

      const deltaX = event.clientX - interaction.pointerX;
      const deltaY = event.clientY - interaction.pointerY;
      if (interaction.kind === "move") {
        updateAttributesRef.current({
          x: Math.round(
            clamp(
              interaction.x + deltaX,
              0,
              PAGE_CONTENT_WIDTH - interaction.width,
            ),
          ),
          y: Math.round(
            clamp(
              interaction.y + deltaY,
              0,
              PAGE_CONTENT_HEIGHT - interaction.height,
            ),
          ),
        });
        return;
      }

      updateAttributesRef.current({
        width: Math.round(
          clamp(
            interaction.width + deltaX,
            MIN_WIDTH,
            PAGE_CONTENT_WIDTH - interaction.x,
          ),
        ),
        height: Math.round(
          clamp(
            interaction.height + deltaY,
            MIN_HEIGHT,
            PAGE_CONTENT_HEIGHT - interaction.y,
          ),
        ),
      });
    },
    [],
  );

  const finishInteraction = useCallback(() => {
    interactionRef.current = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", finishInteraction);
    window.removeEventListener("pointercancel", finishInteraction);
  }, [handlePointerMove]);

  useEffect(
    () => () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishInteraction);
      window.removeEventListener("pointercancel", finishInteraction);
    },
    [finishInteraction, handlePointerMove],
  );

  function startInteraction(event, kind) {
    if (!editor.isEditable) return;
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = {
      kind,
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: node.attrs.x,
      y: node.attrs.y,
      width: node.attrs.width,
      height: node.attrs.height,
    };
    window.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", finishInteraction);
    window.addEventListener("pointercancel", finishInteraction);
  }

  return (
    <NodeViewWrapper
      className={`declaration-box ${selected ? "is-selected" : ""}`}
      style={{
        left: `${node.attrs.x}px`,
        top: `${node.attrs.y}px`,
        width: `${node.attrs.width}px`,
        minHeight: `${node.attrs.height}px`,
      }}
      data-declaration-box="true"
    >
      {editor.isEditable ? (
        <div className="declaration-box-controls" contentEditable={false}>
          <button
            type="button"
            className="declaration-box-move"
            onPointerDown={(event) => startInteraction(event, "move")}
            title="Move declaration"
            aria-label="Move declaration"
          >
            <GripHorizontal className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="declaration-box-delete"
            onClick={deleteNode}
            title="Delete declaration"
            aria-label="Delete declaration"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      <NodeViewContent className="declaration-box-content" />
      {editor.isEditable ? (
        <button
          type="button"
          className="declaration-box-resize"
          contentEditable={false}
          onPointerDown={(event) => startInteraction(event, "resize")}
          title="Resize declaration"
          aria-label="Resize declaration"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
      ) : null}
    </NodeViewWrapper>
  );
}

export const DeclarationBox = Node.create({
  name: "declarationBox",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  selectable: true,

  addAttributes() {
    return {
      x: { default: 24, parseHTML: (element) => Number(element.dataset.x) || 0 },
      y: { default: 72, parseHTML: (element) => Number(element.dataset.y) || 0 },
      width: {
        default: 320,
        parseHTML: (element) => Number(element.dataset.width) || 320,
      },
      height: {
        default: 96,
        parseHTML: (element) => Number(element.dataset.height) || 96,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-declaration-box="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const { x, y, width, height } = HTMLAttributes;
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-declaration-box": "true",
        "data-x": x,
        "data-y": y,
        "data-width": width,
        "data-height": height,
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DeclarationBoxView);
  },
});
