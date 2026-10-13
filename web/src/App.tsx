import { Route, Routes } from 'react-router-dom'
import { SiteLayout } from './components/SiteLayout'
import { AnonymousRoute, ProtectedRoute } from './auth/RouteGuards'
import { DashboardPage } from './routes/DashboardPage'
import { LandingPage } from './routes/LandingPage'
import { LoginPage } from './routes/LoginPage'
import { NotFoundPage } from './routes/NotFoundPage'
import { RegisterPage } from './routes/RegisterPage'
import { ForgotPasswordPage } from './routes/ForgotPasswordPage'
import { ResetPasswordPage } from './routes/ResetPasswordPage'
import { SettingsPage } from './routes/SettingsPage'
import { VerifyEmailPage } from './routes/VerifyEmailPage'
import { ProfilesPage } from './routes/ProfilesPage'
import { PreparePage } from './routes/PreparePage'
import { InterviewsPage } from './routes/InterviewsPage'
import { InterviewDetailsPage } from './routes/InterviewDetailsPage'

export function App() {
  return (
    <Routes>
      <Route element={<SiteLayout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route element={<AnonymousRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/profiles" element={<ProfilesPage />} />
          <Route path="/prepare" element={<PreparePage />} />
          <Route path="/interviews" element={<InterviewsPage />} />
          <Route path="/interviews/:id" element={<InterviewDetailsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
