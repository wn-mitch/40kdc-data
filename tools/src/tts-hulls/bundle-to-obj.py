# Join every mesh in a Unity asset bundle whose transforms are all identity into one OBJ (UnityPy's export, x already flipped).
import sys, UnityPy
env = UnityPy.load(sys.argv[1])
out, base = [], 0
for obj in sorted(env.objects, key=lambda o: o.path_id):
    if obj.type.name == "Transform":
        d = obj.read()
        if d.m_Father.path_id and ((d.m_LocalScale.x, d.m_LocalScale.y, d.m_LocalScale.z) != (1.0, 1.0, 1.0) or abs(d.m_LocalRotation.w) < 0.9999):
            sys.exit(f"non-identity transform on {d.m_GameObject.read().m_Name}")
meshes = [o.read() for o in sorted(env.objects, key=lambda o: o.path_id) if o.type.name == "Mesh"]
for m in meshes:
    n = 0
    for line in m.export().splitlines():
        if line.startswith("v "):
            out.append(line); n += 1
        elif line.startswith("f "):
            out.append("f " + " ".join(str(int(t.split("/")[0]) + base) for t in line.split()[1:]))
    base += n
open(sys.argv[2], "w").write("\n".join(out) + "\n")
print(len(meshes), "meshes", base, "vertices")
