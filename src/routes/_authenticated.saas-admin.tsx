// @ts-nocheck
/**
 * SaaS Admin Dashboard - 8 Tabs
 */

import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { getSaasAccess, listSaasCompanies, updateCompany, listSaasUsers, updateSaasUser, saveSaasPlan, listSubscriptions, saveSubscription, listGlobalSessions, manageGlobalSession, listSaasAudit, getGlobalSettingsFn, saveGlobalSettings } from '@/lib/saas-admin.functions'

export const Route = createFileRoute('/_authenticated/saas-admin')({
  component: SaasAdminDashboard,
})

// ============================================================================
// DASHBOARD TAB COMPONENT
// ============================================================================

function DashboardTab() {
  // Datos simulados para el dashboard (en producción vendrían de funciones)
  const chartData = [
    { name: 'Jan', companies: 12, users: 45, revenue: 2400 },
    { name: 'Feb', companies: 19, users: 52, revenue: 2210 },
    { name: 'Mar', companies: 15, users: 48, revenue: 2290 },
    { name: 'Apr', companies: 22, users: 61, revenue: 2000 },
    { name: 'May', companies: 25, users: 75, revenue: 2181 },
    { name: 'Jun', companies: 28, users: 82, revenue: 2500 },
  ]

  const planDistribution = [
    { name: 'Free', value: 12 },
    { name: 'Pro', value: 18 },
    { name: 'Enterprise', value: 8 },
  ]

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b']

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">
              Total Companies
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">58</div>
            <p className="text-xs text-gray-500">+2.5% from last month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">
              Active Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">243</div>
            <p className="text-xs text-gray-500">+5.2% from last month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">
              Monthly Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$12,543</div>
            <p className="text-xs text-gray-500">+8.1% from last month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">
              Active Subscriptions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">38</div>
            <p className="text-xs text-gray-500">65.5% of companies</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="revenue" stroke="#3b82f6" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Subscription Plans</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={planDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {planDistribution.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Organization Status</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart
                data={[
                  { name: 'Active', value: 45 },
                  { name: 'Trial', value: 10 },
                  { name: 'Suspended', value: 3 },
                ]}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ============================================================================
// COMPANIES TAB COMPONENT
// ============================================================================

function CompaniesTab() {
  const [search, setSearch] = useState('')
  const queryClient = useQueryClient()

  const { data: companies, isLoading } = useQuery({
    queryKey: ['saasCompanies', search],
    queryFn: () => listSaasCompanies({ search, limit: 100 }),
  })

  const updateMutation = useMutation({
    mutationFn: (input: { orgId: string; status: string }) =>
      updateCompany({ orgId: input.orgId, status: input.status as any }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saasCompanies'] })
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="Search companies..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Subscription</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : !companies?.length ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center">
                      No companies found
                    </TableCell>
                  </TableRow>
                ) : (
                  companies.map((company: any) => (
                    <TableRow key={company.id}>
                      <TableCell className="font-medium">{company.name}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            company.status === 'active'
                              ? 'default'
                              : company.status === 'trial'
                                ? 'secondary'
                                : 'destructive'
                          }
                        >
                          {company.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {company.saas_subscriptions?.[0]?.saas_plans?.name ||
                          'None'}
                      </TableCell>
                      <TableCell>
                        {new Date(company.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline">
                              Edit
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Update Company</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4">
                              <div>
                                <label className="text-sm font-medium">
                                  Status
                                </label>
                                <select
                                  defaultValue={company.status}
                                  onChange={(e) =>
                                    updateMutation.mutate({
                                      orgId: company.id,
                                      status: e.target.value,
                                    })
                                  }
                                  className="w-full border rounded px-3 py-2 mt-1"
                                >
                                  <option value="active">Active</option>
                                  <option value="trial">Trial</option>
                                  <option value="suspended">Suspended</option>
                                </select>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================================
// USERS TAB COMPONENT
// ============================================================================

function UsersTab() {
  const queryClient = useQueryClient()

  const { data: users, isLoading } = useQuery({
    queryKey: ['saasUsers'],
    queryFn: () => listSaasUsers({ limit: 100 }),
  })

  const updateMutation = useMutation({
    mutationFn: (input: { userId: string; action: string }) =>
      updateSaasUser({ userId: input.userId, action: input.action as any }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saasUsers'] })
    },
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User ID</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : !users?.length ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center">
                      No users found
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((user: any) => (
                    <TableRow key={user.user_id}>
                      <TableCell className="font-mono text-sm">
                        {user.user_id.substring(0, 8)}...
                      </TableCell>
                      <TableCell>
                        <Badge>{user.role}</Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(user.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateMutation.mutate({
                              userId: user.user_id,
                              action: 'revoke',
                            })
                          }
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================================
// PLANS TAB COMPONENT
// ============================================================================

function PlansTab() {
  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: (input: any) => saveSaasPlan(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saasPlans'] })
    },
  })

  return (
    <div className="space-y-4">
      <Dialog>
        <DialogTrigger asChild>
          <Button>Create Plan</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Subscription Plan</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const formData = new FormData(e.currentTarget)
              saveMutation.mutate({
                name: formData.get('name'),
                price: parseFloat(formData.get('price') as string),
                limits: {
                  maxUsers: parseInt(formData.get('maxUsers') as string),
                  maxWaSessions: parseInt(
                    formData.get('maxWaSessions') as string
                  ),
                  maxContacts: parseInt(formData.get('maxContacts') as string),
                  maxCampaigns: parseInt(formData.get('maxCampaigns') as string),
                  maxAutomations: parseInt(
                    formData.get('maxAutomations') as string
                  ),
                },
              })
            }}
            className="space-y-4"
          >
            <div>
              <label className="text-sm font-medium">Plan Name</label>
              <Input name="name" required className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium">Price ($)</label>
              <Input name="price" type="number" step="0.01" required className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Max Users</label>
                <Input name="maxUsers" type="number" required className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">Max Sessions</label>
                <Input name="maxWaSessions" type="number" required className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">Max Contacts</label>
                <Input name="maxContacts" type="number" required className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">Max Campaigns</label>
                <Input name="maxCampaigns" type="number" required className="mt-1" />
              </div>
            </div>
            <Button type="submit" className="w-full">
              Create Plan
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-gray-600">Plans will be displayed here</p>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================================
// SUBSCRIPTIONS TAB COMPONENT
// ============================================================================

function SubscriptionsTab() {
  const { data: subscriptions, isLoading } = useQuery({
    queryKey: ['saasSubscriptions'],
    queryFn: () => listSubscriptions({ limit: 100 }),
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Renews</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : !subscriptions?.length ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center">
                      No subscriptions found
                    </TableCell>
                  </TableRow>
                ) : (
                  subscriptions.map((sub: any) => (
                    <TableRow key={sub.id}>
                      <TableCell>{sub.organizations?.name}</TableCell>
                      <TableCell>{sub.saas_plans?.name}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            sub.status === 'active'
                              ? 'default'
                              : sub.status === 'trial'
                                ? 'secondary'
                                : 'destructive'
                          }
                        >
                          {sub.status}
                        </Badge>
                      </TableCell>
                      <TableCell>\${sub.amount}</TableCell>
                      <TableCell>
                        {sub.renews_at
                          ? new Date(sub.renews_at).toLocaleDateString()
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================================
// SESSIONS TAB COMPONENT
// ============================================================================

function SessionsTab() {
  const queryClient = useQueryClient()

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['globalSessions'],
    queryFn: () => listGlobalSessions({}),
  })

  const endMutation = useMutation({
    mutationFn: (input: { impersonationId: string }) =>
      manageGlobalSession(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['globalSessions'] })
    },
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Admin</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : !sessions?.length ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center">
                      No active sessions
                    </TableCell>
                  </TableRow>
                ) : (
                  sessions.map((session: any) => (
                    <TableRow key={session.id}>
                      <TableCell className="font-mono text-sm">
                        {session.super_admin_id.substring(0, 8)}...
                      </TableCell>
                      <TableCell>{session.organizations?.name}</TableCell>
                      <TableCell>
                        {new Date(session.started_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            endMutation.mutate({
                              impersonationId: session.id,
                            })
                          }
                        >
                          End
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================================
// AUDIT TAB COMPONENT
// ============================================================================

function AuditTab() {
  const { data: logs, isLoading } = useQuery({
    queryKey: ['saasAudit'],
    queryFn: () => listSaasAudit({ limit: 100 }),
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : !logs?.length ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center">
                      No audit logs
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log: any) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        <Badge variant="outline">{log.action}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {log.actor_user_id?.substring(0, 8)}...
                      </TableCell>
                      <TableCell>{log.org_id?.substring(0, 8)}...</TableCell>
                      <TableCell>
                        {new Date(log.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================================
// SETTINGS TAB COMPONENT
// ============================================================================

function SettingsTab() {
  const { data: settings } = useQuery({
    queryKey: ['globalSettings'],
    queryFn: () => getGlobalSettingsFn({}),
  })

  const saveMutation = useMutation({
    mutationFn: (input: any) => saveGlobalSettings(input),
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Global Settings</CardTitle>
          <CardDescription>
            Configure platform-wide settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const formData = new FormData(e.currentTarget)
              saveMutation.mutate({
                platformName: formData.get('platformName'),
                primaryColor: formData.get('primaryColor'),
              })
            }}
            className="space-y-4"
          >
            <div>
              <label className="text-sm font-medium">Platform Name</label>
              <Input
                name="platformName"
                defaultValue={settings?.platform_name || 'MAPLE CRM'}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Primary Color</label>
              <Input
                name="primaryColor"
                type="color"
                defaultValue={settings?.primary_color || '#2563eb'}
                className="mt-1 h-10"
              />
            </div>
            <Button type="submit">Save Settings</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================================
// MAIN DASHBOARD COMPONENT
// ============================================================================

function SaasAdminDashboard() {
  const { data: access, isLoading } = useQuery({
    queryKey: ['saasAccess'],
    queryFn: () => getSaasAccess({}),
  })

  if (isLoading) {
    return <div className="p-8 text-center">Loading...</div>
  }

  if (!access?.isSuperAdmin) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-lg font-semibold text-red-600">
          Unauthorized
        </h2>
        <p className="text-gray-600">
          Only SUPER_ADMIN users can access this section.
        </p>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">SaaS Administration</h1>
        <p className="text-gray-600 mt-1">
          Manage organizations, subscriptions, and platform settings
        </p>
      </div>

      <Tabs defaultValue="dashboard" className="w-full">
        <TabsList className="grid w-full grid-cols-8">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="companies">Companies</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-6">
          <DashboardTab />
        </TabsContent>

        <TabsContent value="companies" className="mt-6">
          <CompaniesTab />
        </TabsContent>

        <TabsContent value="users" className="mt-6">
          <UsersTab />
        </TabsContent>

        <TabsContent value="plans" className="mt-6">
          <PlansTab />
        </TabsContent>

        <TabsContent value="subscriptions" className="mt-6">
          <SubscriptionsTab />
        </TabsContent>

        <TabsContent value="sessions" className="mt-6">
          <SessionsTab />
        </TabsContent>

        <TabsContent value="audit" className="mt-6">
          <AuditTab />
        </TabsContent>

        <TabsContent value="settings" className="mt-6">
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
