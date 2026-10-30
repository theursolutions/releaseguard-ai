<script setup lang="ts">
import NavMain from '@/components/NavMain.vue';
import NavUser from '@/components/NavUser.vue';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { type NavItem, type SharedData } from '@/types';
import { Link, usePage } from '@inertiajs/vue3';
import { Activity, AudioLines, Boxes, ClipboardCheck, FileSearch, Gauge, LayoutGrid, Package, PlugZap, Users, Wrench } from 'lucide-vue-next';
import { computed } from 'vue';
import AppLogo from './AppLogo.vue';

const page = usePage<SharedData>();

// People who sign in with a CRM account only get the assistant, their performance view, the toolkit and QA testing.
const mainNavItems = computed<NavItem[]>(() => {
    const auth = page.props.auth;
    return [
        { title: 'Assistant', href: '/assistant', icon: AudioLines },
        ...(auth.isCrmUser ? [] : [{ title: 'Command center', href: '/dashboard', icon: LayoutGrid }]),
        ...(auth.canSeePerformance ? [{ title: 'Performance', href: '/performance', icon: Gauge }] : []),
        ...(auth.isCrmUser
            ? []
            : [
                  { title: 'PRD Checker', href: '/prd', icon: FileSearch },
                  { title: 'Monitoring', href: '/monitoring', icon: Activity },
              ]),
        { title: 'Toolkit', href: '/toolkit', icon: Wrench },
        { title: 'QA Testing', href: '/qa-testing', icon: ClipboardCheck },
    ];
});

const adminNavItems: NavItem[] = [
    { title: 'Connections', href: '/connections', icon: PlugZap },
    { title: 'Services', href: '/services', icon: Boxes },
    { title: 'Products', href: '/products', icon: Package },
    { title: 'Users', href: '/users', icon: Users },
];

const isAdmin = computed(() => page.props.auth.isAdmin);
</script>

<template>
    <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader>
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton size="lg" as-child>
                        <Link :href="page.props.auth.isCrmUser ? '/performance' : route('dashboard')">
                            <AppLogo />
                        </Link>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
            <NavMain :items="mainNavItems" label="Tools" />
            <NavMain v-if="isAdmin" :items="adminNavItems" label="Administration" />
        </SidebarContent>

        <SidebarFooter>
            <NavUser />
        </SidebarFooter>
    </Sidebar>
    <slot />
</template>
