<script lang="ts">
  import { NavBar, Placeholder, icons } from '$kernel/api';
</script>

<NavBar title="角色" large back="桌面" />
<Placeholder title="还没有角色" body="导入 PNG 或 JSON 角色卡后会出现在这里。角色属于世界，一个世界可以有多个角色。" paths={icons.person} />
