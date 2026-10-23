# -*- coding: utf-8 -*-
"""
Detalha · Exportar do 3ds Max (2023 ou mais novo)

Gera um .glb pronto para o Detalha, mantendo o que o DWG perde: a hierarquia de
grupos e objetos (cada grupo de primeiro nível vira uma peça), os nomes, as
camadas, os materiais e os eixos de cada objeto (para medir certo peças giradas).
Medidas em metros, com Y para cima.

Uso: Scripting > Run Script... e escolha este arquivo. Com objetos selecionados,
pergunta se exporta só a seleção.
"""
import json
import math
import struct

VERSION = "1.0.0"

# ---------------------------------------------------------------------------
# Escrita do GLB (Python puro, sem depender do 3ds Max)
# ---------------------------------------------------------------------------

# SketchUp e 3ds Max usam Z para cima; o glTF usa Y. Gira o conjunto na raiz.
Z_UP_TO_Y_UP = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]


def srgb_to_linear(c):
    c = max(0.0, min(1.0, c))
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


class GlbBuilder(object):
    """Monta o glTF binário: malhas, materiais e nós com extras do Detalha."""

    def __init__(self):
        self.bin = bytearray()
        self.buffer_views = []
        self.accessors = []
        self.meshes = []
        self.materials = []
        self.nodes = []
        self._material_index = {}

    def _view(self, data, target):
        while len(self.bin) % 4:
            self.bin.append(0)
        offset = len(self.bin)
        self.bin.extend(data)
        self.buffer_views.append(
            {"buffer": 0, "byteOffset": offset, "byteLength": len(data), "target": target}
        )
        return len(self.buffer_views) - 1

    def material(self, name, rgba):
        """Material por nome e cor (sRGB 0..1); repetidos são reaproveitados."""
        key = (name, tuple(round(c, 4) for c in rgba))
        if key in self._material_index:
            return self._material_index[key]
        r, g, b, a = rgba
        mat = {
            "name": name,
            "pbrMetallicRoughness": {
                "baseColorFactor": [srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), a],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.8,
            },
            "doubleSided": True,
        }
        if a < 0.999:
            mat["alphaMode"] = "BLEND"
        self.materials.append(mat)
        self._material_index[key] = len(self.materials) - 1
        return self._material_index[key]

    def mesh(self, name, primitives):
        """primitives: lista de (posições [x,y,z,...], normais, índices, material)."""
        out = []
        for positions, normals, indices, material in primitives:
            if not indices:
                continue
            count = len(positions) // 3
            xs, ys, zs = positions[0::3], positions[1::3], positions[2::3]
            pos_view = self._view(struct.pack("<%df" % len(positions), *positions), 34962)
            self.accessors.append(
                {
                    "bufferView": pos_view,
                    "componentType": 5126,
                    "count": count,
                    "type": "VEC3",
                    "min": [min(xs), min(ys), min(zs)],
                    "max": [max(xs), max(ys), max(zs)],
                }
            )
            pos_acc = len(self.accessors) - 1
            nor_view = self._view(struct.pack("<%df" % len(normals), *normals), 34962)
            self.accessors.append(
                {"bufferView": nor_view, "componentType": 5126, "count": count, "type": "VEC3"}
            )
            nor_acc = len(self.accessors) - 1
            idx_view = self._view(struct.pack("<%dI" % len(indices), *indices), 34963)
            self.accessors.append(
                {"bufferView": idx_view, "componentType": 5125, "count": len(indices), "type": "SCALAR"}
            )
            out.append(
                {
                    "attributes": {"POSITION": pos_acc, "NORMAL": nor_acc},
                    "indices": len(self.accessors) - 1,
                    "material": material,
                }
            )
        if not out:
            return None
        self.meshes.append({"name": name, "primitives": out})
        return len(self.meshes) - 1

    def node(self, name, matrix=None, mesh=None, children=None, extras=None):
        n = {"name": name}
        if matrix is not None and matrix != IDENTITY:
            n["matrix"] = matrix
        if mesh is not None:
            n["mesh"] = mesh
        if children:
            n["children"] = children
        if extras:
            n["extras"] = extras
        self.nodes.append(n)
        return len(self.nodes) - 1

    def build(self, roots, asset_extras):
        root = self.node("Detalha", Z_UP_TO_Y_UP, children=roots)
        doc = {
            "asset": {
                "version": "2.0",
                "generator": "Detalha 3ds Max %s" % VERSION,
                "extras": asset_extras,
            },
            "scene": 0,
            "scenes": [{"nodes": [root]}],
            "nodes": self.nodes,
        }
        if self.meshes:
            doc["meshes"] = self.meshes
            doc["accessors"] = self.accessors
            doc["bufferViews"] = self.buffer_views
            doc["buffers"] = [{"byteLength": len(self.bin)}]
        if self.materials:
            doc["materials"] = self.materials
        js = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        js += b" " * ((4 - len(js) % 4) % 4)
        binary = bytes(self.bin) + b"\0" * ((4 - len(self.bin) % 4) % 4)
        chunks = struct.pack("<II", len(js), 0x4E4F534A) + js
        if self.meshes:
            chunks += struct.pack("<II", len(binary), 0x004E4942) + binary
        return struct.pack("<III", 0x46546C67, 2, 12 + len(chunks)) + chunks


IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def flat_primitive(triangles):
    """triangles: lista de ((x,y,z),(x,y,z),(x,y,z)) -> posições, normais e índices sem vértices
    compartilhados (normal da face, arestas vivas como no modelo)."""
    positions, normals, indices = [], [], []
    for a, b, c in triangles:
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        length = math.sqrt(nx * nx + ny * ny + nz * nz)
        if length < 1e-20:
            continue  # triângulo degenerado
        nx, ny, nz = nx / length, ny / length, nz / length
        base = len(positions) // 3
        for p in (a, b, c):
            positions.extend(p)
            normals.extend((nx, ny, nz))
        indices.extend((base, base + 1, base + 2))
    return positions, normals, indices


# ---------------------------------------------------------------------------
# Leitura da cena do 3ds Max
# ---------------------------------------------------------------------------

UNIT_METERS = {
    "inches": 0.0254,
    "feet": 0.3048,
    "miles": 1609.344,
    "millimeters": 0.001,
    "centimeters": 0.01,
    "meters": 1.0,
    "kilometers": 1000.0,
}


def to_local(m, p, scale):
    """Aplica a matriz (linhas do Max, convenção p * M) e converte para metros."""
    x, y, z = p
    return (
        (x * m[0] + y * m[3] + z * m[6] + m[9]) * scale,
        (x * m[1] + y * m[4] + z * m[7] + m[10]) * scale,
        (x * m[2] + y * m[5] + z * m[8] + m[11]) * scale,
    )


IDENTITY_ROWS = (1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0)


def mat_rows(tm):
    """Matrix3 do Max -> 12 números (linhas X, Y, Z e posição; convenção p * M)."""
    r1, r2, r3, t = tm.row1, tm.row2, tm.row3, tm.row4
    return (r1.x, r1.y, r1.z, r2.x, r2.y, r2.z, r3.x, r3.y, r3.z, t.x, t.y, t.z)


def mat_mul(a, b):
    """p * a * b."""
    out = []
    for r in range(4):
        x, y, z = a[3 * r], a[3 * r + 1], a[3 * r + 2]
        w = 1 if r == 3 else 0
        for c in range(3):
            out.append(x * b[c] + y * b[3 + c] + z * b[6 + c] + w * b[9 + c])
    return tuple(out)


def mat_inverse(m):
    a = [m[0:3], m[3:6], m[6:9]]
    det = (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
           - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
           + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]))
    if abs(det) < 1e-20:
        return IDENTITY_ROWS
    inv = [[0.0] * 3 for _ in range(3)]
    for i in range(3):
        for j in range(3):
            minor = [[a[r][c] for c in range(3) if c != i] for r in range(3) if r != j]
            inv[i][j] = ((-1) ** (i + j)) * (minor[0][0] * minor[1][1] - minor[0][1] * minor[1][0]) / det
    t = m[9:12]
    pos = [-(t[0] * inv[0][k] + t[1] * inv[1][k] + t[2] * inv[2][k]) for k in range(3)]
    return tuple(inv[0] + inv[1] + inv[2] + pos)


def gltf_matrix(m, scale):
    """Linhas do Max -> matriz glTF por colunas, posição em metros."""
    return [
        m[0], m[1], m[2], 0,
        m[3], m[4], m[5], 0,
        m[6], m[7], m[8], 0,
        m[9] * scale, m[10] * scale, m[11] * scale, 1,
    ]


def _color_of(rt, mat, node):
    """Nome e cor (sRGB 0..1) do material, com a cor do objeto como reserva."""
    if mat is None:
        w = node.wirecolor
        return "Cor do objeto", (w.r / 255.0, w.g / 255.0, w.b / 255.0, 1.0)
    for prop in ("base_color", "diffuse", "Diffuse", "diffuse_color", "color", "Color"):
        try:
            c = rt.getProperty(mat, prop)
        except Exception:
            continue
        if c is not None and hasattr(c, "r"):
            alpha = 1.0
            try:
                op = rt.getProperty(mat, "opacity")
                if op is not None:
                    alpha = max(0.0, min(1.0, float(op) / 100.0))
            except Exception:
                pass
            return str(mat.name), (c.r / 255.0, c.g / 255.0, c.b / 255.0, alpha)
    return str(mat.name), (0.8, 0.8, 0.8, 1.0)


def _sub_material(rt, mat, mat_id):
    """Submaterial de um Multi/Sub-Object pelo ID da face."""
    if mat is None or str(rt.classOf(mat)) != "Multimaterial":
        return mat
    ids = list(mat.materialIDList)
    subs = list(mat.materialList)
    if mat_id in ids:
        return subs[ids.index(mat_id)]
    return subs[(mat_id - 1) % len(subs)] if subs else None


def _node_mesh(rt, builder, node, scale):
    """Malha do objeto no espaço do próprio objeto (pivô), em metros, um grupo por material."""
    world = rt.snapshotAsMesh(node)
    try:
        # Mundo -> espaço do objeto, feito em Python (mais rápido e sem depender de operadores do pymxs)
        m = mat_inverse(mat_rows(node.transform))
        verts = []
        for i in range(1, rt.getNumVerts(world) + 1):
            p = rt.getVert(world, i)
            verts.append(to_local(m, (p.x, p.y, p.z), scale))
        by_material = {}
        for f in range(1, rt.getNumFaces(world) + 1):
            face = rt.getFace(world, f)
            tri = tuple(verts[int(k) - 1] for k in (face.x, face.y, face.z))
            mat_id = int(rt.getFaceMatID(world, f))
            by_material.setdefault(mat_id, []).append(tri)
        primitives = []
        for mat_id, tris in by_material.items():
            mat = _sub_material(rt, node.material, mat_id)
            name, rgba = _color_of(rt, mat, node)
            positions, normals, indices = flat_primitive(tris)
            primitives.append((positions, normals, indices, builder.material(name, rgba)))
        return builder.mesh(str(node.name), primitives)
    finally:
        rt.delete(world)


def _is_geometry(rt, node):
    try:
        return rt.superClassOf(node) == rt.GeometryClass and rt.canConvertTo(node, rt.TriMeshGeometry)
    except Exception:
        return False


def _visible(rt, node):
    try:
        return not node.isNodeHidden and (node.layer is None or not node.layer.isHidden)
    except Exception:
        return True


def export_scene(rt, path, only_selection=False, progress=None):
    """Percorre a cena e grava o .glb. Devolve (peças de primeiro nível, objetos)."""
    scale = UNIT_METERS.get(str(rt.units.SystemType).lower(), 0.01) * float(rt.units.SystemScale)
    builder = GlbBuilder()
    selected = set()
    if only_selection:
        for n in rt.selection:
            selected.add(rt.getHandleByAnim(n))
    total = [0]

    def wanted(node):
        if not only_selection:
            return True
        # Exporta o selecionado e tudo que estiver dentro dele
        p = node
        while p is not None:
            if rt.getHandleByAnim(p) in selected:
                return True
            p = p.parent
        return False

    def visit(node, parent_tm):
        """Nó do Max -> nó glTF com a transformação relativa ao pai (grupos e objetos
        guardam os próprios eixos) e a geometria no espaço do próprio objeto."""
        if not _visible(rt, node):
            return None
        tm = mat_rows(node.transform)
        children = []
        for child in node.children:
            idx = visit(child, tm)
            if idx is not None:
                children.append(idx)
        is_group = bool(rt.isGroupHead(node))
        extras = {
            "detalha": {
                "type": "group" if is_group else "object",
                "layer": str(node.layer.name) if node.layer is not None else "",
                "class": str(rt.classOf(node)),
            }
        }
        if _is_geometry(rt, node) and not is_group and wanted(node):
            total[0] += 1
            if progress:
                progress(total[0])
            mesh = _node_mesh(rt, builder, node, scale)
            if mesh is not None:
                children.insert(0, builder.node(str(node.name), None, mesh))
        if not children:
            return None
        local = mat_mul(tm, mat_inverse(parent_tm))
        return builder.node(str(node.name), gltf_matrix(local, scale), None, children, extras)

    roots = []
    for node in rt.rootNode.children:
        idx = visit(node, IDENTITY_ROWS)
        if idx is not None:
            roots.append(idx)
    data = builder.build(
        roots,
        {
            "detalha": {
                "source": "3dsmax",
                "file": str(rt.maxFileName or ""),
                "unit": "m",
                "exporter": VERSION,
            }
        },
    )
    with open(path, "wb") as f:
        f.write(data)
    return len(roots), total[0]


def main():
    from pymxs import runtime as rt

    only = False
    if rt.selection.count > 0:
        only = rt.queryBox(
            "Exportar só os %d objeto(s) selecionado(s)?\n\nNão = exportar a cena inteira."
            % rt.selection.count,
            title="Detalha",
        )
    base = str(rt.maxFileName or "projeto").rsplit(".", 1)[0]
    path = rt.getSaveFileName(
        caption="Salvar para o Detalha",
        filename=base + ".glb",
        types="Detalha (*.glb)|*.glb",
    )
    if not path:
        return
    rt.progressStart("Exportando para o Detalha")
    try:
        parts, objects = export_scene(rt, str(path), only, lambda n: rt.progressUpdate(min(99, n)))
    finally:
        rt.progressEnd()
    rt.messageBox(
        "Arquivo salvo para o Detalha:\n%s\n\n%d peça(s) de primeiro nível, %d objeto(s)."
        "\nAbra o Detalha e envie este arquivo." % (path, parts, objects),
        title="Detalha",
    )


if __name__ == "__main__":
    main()
