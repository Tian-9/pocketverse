<script lang="ts">
  import { NavBar, Placeholder, icons } from '$kernel/api';
</script>

<NavBar title="世界书" large back="桌面" />
<Placeholder title="还没有世界书" body="支持 SillyTavern 格式导入。条目分世界级、角色级、关系级三种作用域。" paths={icons.book} />
