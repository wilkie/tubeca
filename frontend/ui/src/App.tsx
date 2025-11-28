import { useState } from 'react'
import { Container, Typography, Button, Stack, Box } from '@mui/material'
import { PlayArrow, Favorite, Share, Add } from '@mui/icons-material'
import { Header } from './components'
import styles from './App.module.scss'

function App() {
  const [count, setCount] = useState(0)

  return (
    <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
      <Header />
      <Container className={styles.app}>
      <Typography variant="h2" component="h1" gutterBottom>
        Tubeca
      </Typography>

      <div className={styles.card}>
        <Stack spacing={2} direction="row" alignItems="center">
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setCount((count) => count + 1)}
          >
            Count is {count}
          </Button>

          <Button variant="outlined" startIcon={<PlayArrow />}>
            Play
          </Button>

          <Button variant="text" startIcon={<Favorite />}>
            Like
          </Button>

          <Button variant="text" startIcon={<Share />}>
            Share
          </Button>
        </Stack>
      </div>
      </Container>
    </Box>
  )
}

export default App
