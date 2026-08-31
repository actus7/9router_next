"use client";

import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { ModelItem } from "./ModelItem";

export function SortableModelList({ models, setModels }: {
  models: string[];
  setModels: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const modelItems = models.map((model, i) => ({ uid: `item-${i}`, model }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = modelItems.findIndex((m) => m.uid === active.id);
      const newIndex = modelItems.findIndex((m) => m.uid === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        setModels((prev) => arrayMove(prev, oldIndex, newIndex));
      }
    }
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    setModels((prev) => { const n = [...prev]; [n[index - 1], n[index]] = [n[index], n[index - 1]]; return n; });
  };

  const handleMoveDown = (index: number) => {
    if (index >= models.length - 1) return;
    setModels((prev) => { const n = [...prev]; [n[index], n[index + 1]] = [n[index + 1], n[index]]; return n; });
  };

  const handleRemove = (index: number) => {
    setModels((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
      <SortableContext items={modelItems.map((m) => m.uid)} strategy={verticalListSortingStrategy}>
        <div className="flex max-h-[55vh] min-w-0 flex-col gap-1 overflow-y-auto sm:max-h-[350px]">
          {modelItems.map(({ uid, model }, index) => (
            <ModelItem
              key={uid}
              id={uid}
              index={index}
              model={model}
              isFirst={index === 0}
              isLast={index === modelItems.length - 1}
              onEdit={(newVal) => { setModels((prev) => { const u = [...prev]; u[index] = newVal; return u; }); }}
              onMoveUp={() => handleMoveUp(index)}
              onMoveDown={() => handleMoveDown(index)}
              onRemove={() => handleRemove(index)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
