# Custom car model

Put a binary glTF file here named **`car.glb`**, then reload the game. Both teams use it; collision does not change. Without a file, the built-in car is used.

## Requirements
- `.glb` (or `.gltf` with embedded buffers), **not** Draco/Meshopt compressed.
- Ideally the car faces **+Z**, with Y up. Otherwise set `rotationY` in `car.json`.
- Name the paint material something containing `Body`/`Paint` (it's recolored blue/orange per team).
- Name wheel nodes something containing `Wheel`/`Tire`, with the axle along the node's local X (they spin with speed). Wheels whose names contain `Front`/`FL`/`FR` also steer.
- Only use models you have the rights to (no models ripped from other games).

## Optional `car.json`
```json
{
  "file": "car.glb",
  "rotationY": 0,
  "length": 1.3,
  "scale": null,
  "offset": [0, 0, 0],
  "paintMaterials": ["Body"],
  "wheelNodes": ["Wheel"],
  "nozzle": null
}
```
- `length`: target car length in meters. The model is auto-scaled to it (the hitbox is 1.2 m).
- `offset`: nudge after fitting (x, y, z in meters).
- `nozzle`: `[x, y, z]` for the boost flame. By default it's the rear-center of the model.
